import { loadConfig } from './config.js';
import { calculateMomentum } from './momentum.js';
import { classifyRisk } from './risk.js';
import { RpcManager } from './rpc.js';
import { TelemetryBus } from './telemetry.js';

const config = loadConfig();
const telemetry = new TelemetryBus();
const rpc = new RpcManager(config.rpcUrls, telemetry, config.maxRpcLatencyMs, config.maxBlockLag);

const momentum = calculateMomentum({
  priceAcceleration: 0,
  volumeAcceleration: 0,
  buyPressure: 0,
  uniqueBuyerScore: 0,
  liquidityScore: 0,
  breakoutScore: 0,
});
const risk = classifyRisk(100);

console.log(JSON.stringify({
  app: 'PulseHood',
  chainId: config.chainId,
  tradingMode: config.tradingMode,
  liveEnabled: config.liveEnabled,
  rpcEndpoints: config.rpcUrls.length,
  momentum,
  risk,
  rpcChainId: rpc.chainId,
}, null, 2));
