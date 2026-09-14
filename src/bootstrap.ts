import { loadConfig } from './config.js';
import { RadarIngest } from './radar-ingest.js';
import { RpcManager } from './rpc.js';
import { TelemetryBus } from './telemetry.js';
import { PaperTradingRuntime } from './trading-runtime.js';

// index.ts owns the HTTP/dashboard radar instance. Keep that instance read-only for
// swap polling and let the paper runtime be the single consumer of swap ranges.
const radarPrototype = RadarIngest.prototype as unknown as {
  seedPools: (...args: never[]) => Promise<void>;
  poll: (...args: never[]) => Promise<unknown>;
};
const originalSeedPools = radarPrototype.seedPools;
const originalPoll = radarPrototype.poll;
let dashboardIngest: RadarIngest | undefined;
radarPrototype.seedPools = async function (...args: never[]): Promise<void> {
  if (dashboardIngest === undefined) dashboardIngest = this as unknown as RadarIngest;
  await originalSeedPools.apply(this, args);
};
radarPrototype.poll = async function (...args: never[]): Promise<unknown> {
  if (this === dashboardIngest) return undefined;
  return originalPoll.apply(this, args);
};

await import('./index.js');
const config = loadConfig();
const telemetry = new TelemetryBus();
const rpc = new RpcManager(config.rpcUrls, telemetry, config.maxRpcLatencyMs, config.maxBlockLag);

async function start(): Promise<void> {
  for (;;) {
    try {
      await rpc.probe();
      const client = rpc.getClient();
      if (await client.getChainId() !== config.chainId) throw new Error('RPC chain mismatch');
      const ingest = new RadarIngest(client);
      await (ingest as unknown as { seedPools: () => Promise<void> }).seedPools();
      const runtime = new PaperTradingRuntime(client, telemetry, ingest);
      runtime.start();
      console.log(JSON.stringify({ event: 'paper_runtime_ready', chainId: config.chainId, mode: 'paper', poolsSeeded: true, dashboardRadarPollingDisabled: true }));
      return;
    } catch (error) {
      console.warn(JSON.stringify({ event: 'paper_runtime_waiting_for_rpc', message: error instanceof Error ? error.message : String(error) }));
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

await start();
