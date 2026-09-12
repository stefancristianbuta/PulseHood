import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { WebSocketChainFeed } from './chain-feed.js';
import { calculateMomentum } from './momentum.js';
import { classifyRisk } from './risk.js';
import { RpcManager } from './rpc.js';
import { TelemetryBus } from './telemetry.js';

const config = loadConfig();
const telemetry = new TelemetryBus();
const rpc = new RpcManager(config.rpcUrls, telemetry, config.maxRpcLatencyMs, config.maxBlockLag);

async function main(): Promise<void> {
  if (config.tradingMode !== 'paper' || config.liveEnabled) {
    throw new Error('Deploy safety gate: only paper mode is permitted in this V1 runtime');
  }

  const momentum = calculateMomentum({
    priceAcceleration: 0,
    volumeAcceleration: 0,
    buyPressure: 0,
    uniqueBuyerScore: 0,
    liquidityScore: 0,
    breakoutScore: 0,
  });
  const risk = classifyRisk(100);

  let latestBlock: bigint | undefined;
  let rpcReady = false;
  let rpcChainId: number | undefined;
  let feedIndex = 0;

  const feeds = config.wsUrls.map((url) => new WebSocketChainFeed(url, telemetry));

  const server = createServer((req, res) => {
    if (req.url === '/health' || req.url === '/api/status') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        app: 'PulseHood',
        status: 'ok',
        chainId: config.chainId,
        tradingMode: config.tradingMode,
        liveEnabled: config.liveEnabled,
        rpcReady,
        rpcChainId: rpcChainId ?? null,
        latestBlock: latestBlock?.toString() ?? null,
        rpcStatus: rpc.getStatus(),
      }));
      return;
    }

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>PulseHood</title></head><body><main><h1>PulseHood</h1><p>Robinhood Chain momentum radar</p><p>Status: <strong>ONLINE</strong></p><p>Mode: <strong>${config.tradingMode.toUpperCase()}</strong></p><p>Chain: <strong>${config.chainId}</strong></p><p>RPC: <strong>${rpcReady ? 'READY' : 'CONNECTING'}</strong></p><p>Latest block: <strong>${latestBlock?.toString() ?? 'waiting'}</strong></p></main></body></html>`);
  });

  const port = Number(process.env.PORT ?? 10000);
  server.listen(port, '0.0.0.0', () => {
    console.log(JSON.stringify({
      app: 'PulseHood',
      chainId: config.chainId,
      tradingMode: config.tradingMode,
      liveEnabled: config.liveEnabled,
      rpcEndpoints: config.rpcUrls.length,
      wsEndpoints: config.wsUrls.length,
      momentum,
      risk,
      httpPort: port,
    }, null, 2));
  });

  const probeRpc = async (): Promise<void> => {
    try {
      await rpc.probe();
      const client = rpc.getClient();
      const chainId = await client.getChainId();
      if (chainId !== config.chainId) {
        throw new Error(`RPC chain mismatch: expected ${config.chainId}, received ${chainId}`);
      }
      rpcChainId = chainId;
      rpcReady = true;
      telemetry.emitEvent({
        correlationId: TelemetryBus.correlationId('RPC'),
        module: 'rpc',
        event: 'ready',
        status: 'ok',
        payload: { chainId },
      });
    } catch (error) {
      rpcReady = false;
      telemetry.emitEvent({
        correlationId: TelemetryBus.correlationId('RPC'),
        module: 'rpc',
        event: 'unavailable_retrying',
        status: 'warning',
        payload: { error: error instanceof Error ? error.message : String(error) },
      });
      console.warn('RPC unavailable; retrying in 15s');
    }
  };

  await probeRpc();
  const rpcRetry = setInterval(() => { void probeRpc(); }, 15_000);

  const startFeed = (): void => {
    const feed = feeds[feedIndex];
    if (feed === undefined) throw new Error('No WebSocket feed configured');
    feed.start(async (block) => {
      latestBlock = block.number;
      telemetry.emitEvent({
        correlationId: TelemetryBus.correlationId('RADAR'),
        module: 'radar',
        event: 'block_ingested',
        block: block.number,
        status: 'ok',
        payload: { transactionCount: block.transactionHashes.length, feedIndex },
      });
    });
  };

  startFeed();

  const heartbeat = setInterval(() => {
    telemetry.emitEvent({
      correlationId: TelemetryBus.correlationId('HEARTBEAT'),
      module: 'app',
      event: 'heartbeat',
      status: 'ok',
      payload: {
        latestBlock: latestBlock?.toString() ?? null,
        feedIndex,
        rpcReady,
        tradingMode: config.tradingMode,
        liveEnabled: config.liveEnabled,
      },
    });
  }, 30_000);

  const shutdown = (): void => {
    clearInterval(heartbeat);
    clearInterval(rpcRetry);
    for (const feed of feeds) feed.stop();
    server.close();
    console.log('PulseHood shutdown complete');
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
