import { loadConfig } from './config.js';
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
    momentum,
    risk,
    rpcChainId,
    rpcStatus: rpc.getStatus(),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
