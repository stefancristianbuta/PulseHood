import { createPublicClient, fallback, http, webSocket, type PublicClient, type Transport } from 'viem';
import { CHAIN } from './config.js';
import { TelemetryBus } from './telemetry.js';

interface RpcEndpoint { url: string; client: PublicClient<Transport>; latencyMs: number; blockNumber?: bigint; failures: number; healthy: boolean; }
const transportFor = (url: string) => url.startsWith('wss://')
  ? webSocket(url, { reconnect: true, retryCount: 1, timeout: 4_000 })
  : http(url, { retryCount: 1, timeout: 4_000 });

export class RpcManager {
  private readonly endpoints: RpcEndpoint[];
  private readonly resilientClient: PublicClient<Transport>;

  constructor(urls: string[], private readonly telemetry: TelemetryBus, private readonly maxLatencyMs = 750, private readonly maxBlockLag = 3) {
    const normalizedUrls = [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
    if (normalizedUrls.length === 0) throw new Error('At least one RPC endpoint is required');
    this.endpoints = normalizedUrls.map((url) => ({
      url, client: createPublicClient({ chain: CHAIN, transport: transportFor(url) }) as PublicClient<Transport>,
      latencyMs: Number.POSITIVE_INFINITY, failures: 0, healthy: false,
    }));
    this.resilientClient = createPublicClient({
      chain: CHAIN,
      transport: fallback(normalizedUrls.map(transportFor), { rank: true, retryCount: 1 }),
    }) as PublicClient<Transport>;
  }

  async probe(): Promise<void> {
    const results = await Promise.all(this.endpoints.map(async (endpoint) => {
      const started = performance.now();
      try {
        const blockNumber = await endpoint.client.getBlockNumber();
        endpoint.latencyMs = performance.now() - started; endpoint.blockNumber = blockNumber; endpoint.failures = 0;
        endpoint.healthy = endpoint.latencyMs <= this.maxLatencyMs;
        this.telemetry.emitEvent({ correlationId: TelemetryBus.correlationId('RPC'), module: 'rpc', event: 'probe', latencyMs: endpoint.latencyMs, status: endpoint.healthy ? 'ok' : 'warning', payload: { url: endpoint.url, blockNumber: blockNumber.toString() } });
        return blockNumber;
      } catch (error) {
        endpoint.failures += 1; endpoint.healthy = false;
        this.telemetry.emitEvent({ correlationId: TelemetryBus.correlationId('RPC'), module: 'rpc', event: 'probe_failed', status: 'error', payload: { url: endpoint.url, error: error instanceof Error ? error.message : String(error) } });
        return undefined;
      }
    }));
    const liveBlocks = results.filter((value): value is bigint => value !== undefined);
    if (liveBlocks.length === 0) throw new Error('All RPC endpoints are unavailable');
    const head = liveBlocks.reduce((max, value) => value > max ? value : max);
    for (const endpoint of this.endpoints) if (endpoint.blockNumber !== undefined) endpoint.healthy = endpoint.healthy && head - endpoint.blockNumber <= BigInt(this.maxBlockLag);
  }

  getClient(): PublicClient<Transport> { return this.resilientClient; }
  getStatus() { return this.endpoints.map(({ url, latencyMs, blockNumber, failures, healthy }) => ({ url, latencyMs, blockNumber, failures, healthy })); }
  get chainId(): number { return CHAIN.id; }
}
