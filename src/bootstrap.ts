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
let dashboardIngest: unknown;
radarPrototype.seedPools = async function (...args: never[]): Promise<void> {
  if (dashboardIngest === undefined) dashboardIngest = this;
  await originalSeedPools.apply(this, args);
};
radarPrototype.poll = async function (...args: never[]): Promise<unknown> {
  if (this === dashboardIngest) return undefined;
  return originalPoll.apply(this, args);
};

await import('./index.js');
const dashboard = (globalThis as typeof globalThis & { __pulsehood?: {
  entriesEnabled: boolean;
  runtimeRunning: boolean;
  runtimeStop?: () => void;
  runtimeResume?: () => void;
  runtimeSellAll?: () => unknown[];
  latestBlock?: bigint;
  swapsReceived: number;
  candidates: Map<string, Record<string, unknown>>;
} }).__pulsehood;
const config = loadConfig();
const telemetry = new TelemetryBus();
const rpc = new RpcManager(config.rpcUrls, telemetry, config.maxRpcLatencyMs, config.maxBlockLag);

function updateCandidate(event: Parameters<TelemetryBus['emitEvent']>[0]): void {
  if (dashboard === undefined || event.token === undefined) return;
  const previous = dashboard.candidates.get(event.token.toLowerCase()) ?? {
    token: event.token,
    protocol: String(event.payload?.protocol ?? 'unknown'),
    pool: String(event.payload?.pool ?? 'unknown'),
    direction: String(event.payload?.direction ?? '—'),
    momentum: 0, risk: 100, buyPressurePct: 0, volumeAccelerationPct: 0,
    uniqueBuyers: 0, liquidityUsd: 0, priceChangePct: 0, breakoutScore: 0,
    signal: 'WATCH', status: 'DISCOVERED', updatedAt: Date.now(),
  };
  const p = event.payload ?? {};
  const next = { ...previous,
    protocol: String(p.protocol ?? previous.protocol), pool: String(p.pool ?? previous.pool),
    direction: String(p.direction ?? previous.direction),
    momentum: Number(p.momentum ?? previous.momentum), risk: Number(p.risk ?? previous.risk),
    buyPressurePct: Number(p.buyPressurePct ?? previous.buyPressurePct),
    volumeAccelerationPct: Number(p.volumeAccelerationPct ?? previous.volumeAccelerationPct),
    uniqueBuyers: Number(p.uniqueBuyers ?? previous.uniqueBuyers),
    liquidityUsd: Number(p.liquidityUsd ?? previous.liquidityUsd),
    priceChangePct: Number(p.priceChangePct ?? previous.priceChangePct),
    breakoutScore: Number(p.breakoutScore ?? previous.breakoutScore),
    signal: String(p.signal ?? previous.signal),
    status: event.event === 'signal_evaluated' ? (event.status === 'ok' ? 'QUALIFIED' : 'EVALUATED') : previous.status,
    reason: event.event === 'paper_candidate_rejected' ? String(p.reason ?? 'rejected') : previous.reason,
    updatedAt: Date.now(),
  };
  dashboard.candidates.set(event.token.toLowerCase(), next);
  while (dashboard.candidates.size > 100) {
    const oldest = [...dashboard.candidates.entries()].sort((a,b)=>Number(a[1].updatedAt)-Number(b[1].updatedAt))[0];
    if (oldest === undefined) break;
    dashboard.candidates.delete(oldest[0]);
  }
}

telemetry.onEvent((event) => {
  if (dashboard === undefined) return;
  if (event.block !== undefined) dashboard.latestBlock = event.block;
  if (event.event === 'signal_evaluated' || event.event === 'paper_candidate_rejected') updateCandidate(event);
});

async function start(): Promise<void> {
  for (;;) {
    try {
      await rpc.probe();
      const client = rpc.getClient();
      if (await client.getChainId() !== config.chainId) throw new Error('RPC chain mismatch');
      const ingest = new RadarIngest(client);
      await (ingest as unknown as { seedPools: () => Promise<void> }).seedPools();
      const runtime = new PaperTradingRuntime(client, telemetry, ingest);
      if (dashboard !== undefined) {
        dashboard.runtimeRunning = true;
        dashboard.entriesEnabled = true;
        dashboard.runtimeStop = () => { runtime.stopEntries(); dashboard.entriesEnabled = false; };
        dashboard.runtimeResume = () => {
          const internal = runtime as unknown as { positions?: { setEntriesEnabled?: (enabled: boolean) => void } };
          internal.positions?.setEntriesEnabled?.(true);
          dashboard.entriesEnabled = true;
        };
        dashboard.runtimeSellAll = () => { const closed = runtime.closeAll(); dashboard.entriesEnabled = false; return closed; };
      }
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
