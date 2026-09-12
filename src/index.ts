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
  const started = performance.now();
  await rpc.probe();
  const client = rpc.getClient();
  const rpcChainId = await client.getChainId();

  if (rpcChainId !== config.chainId) {
    throw new Error(`RPC chain mismatch: expected ${config.chainId}, received ${rpcChainId}`);
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

  telemetry.emitEvent({
    correlationId: TelemetryBus.correlationId('BOOT'),
    module: 'app',
    event: 'startup_check',
    latencyMs: performance.now() - started,
    status: 'ok',
    payload: { chainId: config.chainId, rpcChainId, tradingMode: config.tradingMode },
  });

  console.log(JSON.stringify({
    app: 'PulseHood',
    chainId: config.chainId,
    tradingMode: config.tradingMode,
    liveEnabled: config.liveEnabled,
    rpcEndpoints: config.rpcUrls.length,
    wsEndpoints: config.wsUrls.length,
    momentum,
    risk,
    rpcChainId,
    rpcStatus: rpc.getStatus(),
  }, null, 2));

  if (config.tradingMode !== 'paper' || config.liveEnabled) {
    throw new Error('Deploy safety gate: only paper mode is permitted in this V1 runtime');
  }

  const feeds = config.wsUrls.map((url) => new WebSocketChainFeed(url, telemetry));
  let latestBlock: bigint | undefined;
  let feedIndex = 0;

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
        tradingMode: config.tradingMode,
        liveEnabled: config.liveEnabled,
      },
    });
  }, 30_000);

  const shutdown = (): void => {
    clearInterval(heartbeat);
    for (const feed of feeds) feed.stop();
    console.log('PulseHood shutdown complete');
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
