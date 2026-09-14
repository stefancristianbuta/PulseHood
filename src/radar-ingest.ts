import { decodeEventLog, parseAbi, type PublicClient, type Transport } from 'viem';
import type { NormalizedSwap } from './swap-event.js';
import { normalizeSwapEvent } from './swap-event.js';
import { DEFAULT_DEX_REGISTRY, type DexProtocol } from './dex-registry.js';

const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'.toLowerCase();
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'.toLowerCase();
const V3_SWAP = parseAbi(['event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)']);
const V2_SWAP = parseAbi(['event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)']);
const TOKEN_ABI = parseAbi(['function token0() view returns (address)', 'function token1() view returns (address)']);
const FACTORY_ABI = parseAbi(['function factory() view returns (address)']);

type Client = PublicClient<Transport>;
type EventProtocol = 'v2' | 'v3';
interface PoolTokens { token0: `0x${string}`; token1: `0x${string}`; }
export interface RadarIngestResult { swaps: NormalizedSwap[]; fromBlock: bigint; toBlock: bigint; }

const deployments = DEFAULT_DEX_REGISTRY.listEnabled();
const factoryToProtocol = new Map<string, DexProtocol>();
for (const deployment of deployments) {
  if (deployment.factory !== undefined) factoryToProtocol.set(deployment.factory.toLowerCase(), deployment.protocol);
}

function isQuote(token: `0x${string}`): boolean {
  const normalized = token.toLowerCase();
  return normalized === WETH || normalized === USDG;
}

export class RadarIngest {
  private readonly poolTokens = new Map<string, PoolTokens>();
  private readonly poolProtocols = new Map<string, DexProtocol>();
  private lastBlock: bigint | undefined;
  private recentSwaps: NormalizedSwap[] = [];
  private seeded = false;

  constructor(private readonly client: Client, private readonly maxRecentSwaps = 200) {}

  async seedPools(): Promise<void> {
    if (this.seeded) return;
    this.seeded = true;
    console.log(JSON.stringify({
      event: 'pool_seed_dynamic',
      mode: 'registered-dex-event-discovery',
      enabledDexes: deployments.map((deployment) => deployment.id),
      v4PoolManager: deployments.find((deployment) => deployment.protocol === 'uniswap-v4')?.poolManager,
    }));
  }

  private async getLogsAdaptive(protocol: EventProtocol, abi: readonly unknown[], fromBlock: bigint, toBlock: bigint): Promise<any[]> {
    const fetchRange = async (from: bigint, to: bigint): Promise<any[]> => {
      try {
        return await this.client.getLogs({ event: abi[0] as never, fromBlock: from, toBlock: to });
      } catch (error) {
        if (from === to) throw error;
        const midpoint = from + ((to - from) / 2n);
        console.warn(JSON.stringify({ event: 'log_range_fallback', protocol, fromBlock: from.toString(), toBlock: to.toString(), splitAt: midpoint.toString(), message: error instanceof Error ? error.message : String(error) }));
        const left = await fetchRange(from, midpoint);
        const right = await fetchRange(midpoint + 1n, to);
        return [...left, ...right];
      }
    };
    return fetchRange(fromBlock, toBlock);
  }

  private async tokensFor(pool: `0x${string}`): Promise<PoolTokens | undefined> {
    const key = pool.toLowerCase();
    const cached = this.poolTokens.get(key);
    if (cached !== undefined) return cached;
    try {
      const [token0, token1] = await Promise.all([
        this.client.readContract({ address: pool, abi: TOKEN_ABI, functionName: 'token0' }),
        this.client.readContract({ address: pool, abi: TOKEN_ABI, functionName: 'token1' }),
      ]);
      const tokens = { token0: token0 as `0x${string}`, token1: token1 as `0x${string}` };
      this.poolTokens.set(key, tokens);
      return tokens;
    } catch (error) {
      console.warn(JSON.stringify({ event: 'pool_token_read_error', pool, message: error instanceof Error ? error.message : String(error) }));
      return undefined;
    }
  }

  private async identifyProtocol(pool: `0x${string}`, eventProtocol: EventProtocol): Promise<DexProtocol | undefined> {
    const key = pool.toLowerCase();
    const cached = this.poolProtocols.get(key);
    if (cached !== undefined) return cached;

    try {
      const factory = await this.client.readContract({ address: pool, abi: FACTORY_ABI, functionName: 'factory' }) as `0x${string}`;
      const protocol = factoryToProtocol.get(factory.toLowerCase());
      if (protocol !== undefined) {
        this.poolProtocols.set(key, protocol);
        return protocol;
      }
      return undefined;
    } catch (error) {
      console.warn(JSON.stringify({ event: 'pool_factory_read_error', pool, eventProtocol, message: error instanceof Error ? error.message : String(error) }));
      return undefined;
    }
  }

  private async normalizeLogs(eventProtocol: EventProtocol, abi: readonly unknown[], logs: any[]): Promise<NormalizedSwap[]> {
    const swaps: NormalizedSwap[] = [];
    for (const log of logs) {
      if (log.transactionHash === null || log.logIndex === undefined) continue;
      try {
        const pool = log.address as `0x${string}`;
        const protocol = await this.identifyProtocol(pool, eventProtocol);
        if (protocol === undefined) continue;
        if (eventProtocol === 'v2' && !['uniswap-v2', 'pons-v2'].includes(protocol)) continue;
        if (eventProtocol === 'v3' && !['uniswap-v3', 'ramses-v3'].includes(protocol)) continue;

        const tokens = await this.tokensFor(pool);
        if (tokens === undefined) continue;
        const token0IsQuote = isQuote(tokens.token0);
        const token1IsQuote = isQuote(tokens.token1);
        if (token0IsQuote === token1IsQuote) continue;

        const targetToken = token0IsQuote ? tokens.token1 : tokens.token0;
        const decoded = decodeEventLog({ abi, topics: log.topics, data: log.data });
        const args = decoded.args as Record<string, unknown>;
        const trader = typeof args.sender === 'string' && /^0x[0-9a-fA-F]{40}$/.test(args.sender)
          ? args.sender as `0x${string}` : undefined;
        const event: Parameters<typeof normalizeSwapEvent>[0] = {
          status: 'decoded', address: pool, protocol, eventName: 'Swap', args,
          transactionHash: log.transactionHash, logIndex: Number(log.logIndex),
        };
        const normalized = normalizeSwapEvent(event, {
          address: pool, token0: tokens.token0, token1: tokens.token1, targetToken,
        });
        if (normalized.status === 'normalized') swaps.push(trader === undefined ? normalized : { ...normalized, trader });
      } catch (error) {
        console.warn(JSON.stringify({ event: 'swap_log_decode_error', protocol: eventProtocol, pool: log.address, transactionHash: log.transactionHash, logIndex: Number(log.logIndex), message: error instanceof Error ? error.message : String(error) }));
      }
    }
    return swaps;
  }

  async poll(toBlock: bigint, maxRange = 25n): Promise<RadarIngestResult | undefined> {
    await this.seedPools();
    if (this.lastBlock === undefined) this.lastBlock = toBlock > maxRange ? toBlock - maxRange : 0n;
    const fromBlock = this.lastBlock + 1n;
    if (fromBlock > toBlock) return undefined;
    const scanTo = fromBlock + maxRange - 1n < toBlock ? fromBlock + maxRange - 1n : toBlock;

    const [v3Logs, v2Logs] = await Promise.all([
      this.getLogsAdaptive('v3', V3_SWAP, fromBlock, scanTo),
      this.getLogsAdaptive('v2', V2_SWAP, fromBlock, scanTo),
    ]);
    const [v3Swaps, v2Swaps] = await Promise.all([
      this.normalizeLogs('v3', V3_SWAP, v3Logs),
      this.normalizeLogs('v2', V2_SWAP, v2Logs),
    ]);
    const swaps = [...v3Swaps, ...v2Swaps].sort((a, b) => a.logIndex - b.logIndex);
    this.lastBlock = scanTo;
    if (swaps.length > 0) {
      this.recentSwaps = [...this.recentSwaps, ...swaps].slice(-this.maxRecentSwaps);
      const dexCounts = swaps.reduce<Record<string, number>>((counts, swap) => {
        const key = swap.protocol ?? 'unknown';
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {});
      console.log(JSON.stringify({ event: 'swaps_ingested_batch', count: swaps.length, rawV3Logs: v3Logs.length, rawV2Logs: v2Logs.length, fromBlock: fromBlock.toString(), toBlock: scanTo.toString(), cachedPools: this.poolTokens.size, dexCounts }));
    }
    return { swaps, fromBlock, toBlock: scanTo };
  }

  getRecentSwaps(): NormalizedSwap[] { return [...this.recentSwaps]; }
  reset(): void { this.lastBlock = undefined; this.recentSwaps = []; this.poolTokens.clear(); this.poolProtocols.clear(); this.seeded = false; }
  stop(): void { /* polling is owned by PaperTradingRuntime */ }
}
