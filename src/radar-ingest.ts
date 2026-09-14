import { decodeEventLog, parseAbi, type PublicClient, type Transport } from 'viem';
import type { NormalizedSwap } from './swap-event.js';
import { normalizeSwapEvent } from './swap-event.js';

const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'.toLowerCase();
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'.toLowerCase();
const V3_SWAP = parseAbi(['event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)']);
const V2_SWAP = parseAbi(['event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)']);
const TOKEN_ABI = parseAbi(['function token0() view returns (address)', 'function token1() view returns (address)']);

type Client = PublicClient<Transport>;
type Protocol = 'uniswap-v2' | 'uniswap-v3';
interface PoolTokens { token0: `0x${string}`; token1: `0x${string}`; }
export interface RadarIngestResult { swaps: NormalizedSwap[]; fromBlock: bigint; toBlock: bigint; }

function isQuote(token: `0x${string}`): boolean {
  const normalized = token.toLowerCase();
  return normalized === WETH || normalized === USDG;
}

export class RadarIngest {
  private readonly poolTokens = new Map<string, PoolTokens>();
  private lastBlock: bigint | undefined;
  private recentSwaps: NormalizedSwap[] = [];
  private seeded = false;

  constructor(private readonly client: Client, private readonly maxRecentSwaps = 200) {}

  async seedPools(): Promise<void> {
    if (this.seeded) return;
    // Discovery is event-driven. We no longer enumerate tens of thousands of V2
    // factory pairs at startup; that was the source of public-RPC 403/rate limits.
    this.seeded = true;
    console.log(JSON.stringify({ event: 'pool_seed_dynamic', mode: 'chain-wide-swap-events', protocols: ['v2-compatible', 'v3-compatible'] }));
  }

  private async getLogsAdaptive(protocol: Protocol, abi: readonly unknown[], fromBlock: bigint, toBlock: bigint): Promise<any[]> {
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

  private async normalizeLogs(protocol: Protocol, abi: readonly unknown[], logs: any[]): Promise<NormalizedSwap[]> {
    const swaps: NormalizedSwap[] = [];
    for (const log of logs) {
      if (log.transactionHash === null || log.logIndex === undefined) continue;
      try {
        const tokens = await this.tokensFor(log.address as `0x${string}`);
        if (tokens === undefined) continue;
        const token0IsQuote = isQuote(tokens.token0);
        const token1IsQuote = isQuote(tokens.token1);
        // Radar V1 scores token/WETH and token/USDG markets. Quote/quote and
        // token/token pools are intentionally ignored until cross-quote pricing lands.
        if (token0IsQuote === token1IsQuote) continue;
        const targetToken = token0IsQuote ? tokens.token1 : tokens.token0;
        const decoded = decodeEventLog({ abi, topics: log.topics, data: log.data });
        const args = decoded.args as Record<string, unknown>;
        const trader = typeof args.sender === 'string' && /^0x[0-9a-fA-F]{40}$/.test(args.sender)
          ? args.sender as `0x${string}` : undefined;
        const event: Parameters<typeof normalizeSwapEvent>[0] = {
          status: 'decoded', address: log.address, protocol, eventName: 'Swap', args,
          transactionHash: log.transactionHash, logIndex: Number(log.logIndex),
        };
        const normalized = normalizeSwapEvent(event, {
          address: log.address, token0: tokens.token0, token1: tokens.token1, targetToken,
        });
        if (normalized.status === 'normalized') swaps.push(trader === undefined ? normalized : { ...normalized, trader });
      } catch (error) {
        console.warn(JSON.stringify({ event: 'swap_log_decode_error', protocol, pool: log.address, transactionHash: log.transactionHash, logIndex: Number(log.logIndex), message: error instanceof Error ? error.message : String(error) }));
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

    // Query by event signature rather than a tiny hard-coded address list. This
    // discovers active/new pools automatically and catches compatible V2/V3 venues.
    const [v3Logs, v2Logs] = await Promise.all([
      this.getLogsAdaptive('uniswap-v3', V3_SWAP, fromBlock, scanTo),
      this.getLogsAdaptive('uniswap-v2', V2_SWAP, fromBlock, scanTo),
    ]);
    const [v3Swaps, v2Swaps] = await Promise.all([
      this.normalizeLogs('uniswap-v3', V3_SWAP, v3Logs),
      this.normalizeLogs('uniswap-v2', V2_SWAP, v2Logs),
    ]);
    const swaps = [...v3Swaps, ...v2Swaps].sort((a, b) => a.logIndex - b.logIndex);
    this.lastBlock = scanTo;
    if (swaps.length > 0) {
      this.recentSwaps = [...this.recentSwaps, ...swaps].slice(-this.maxRecentSwaps);
      console.log(JSON.stringify({ event: 'swaps_ingested_batch', count: swaps.length, rawV3Logs: v3Logs.length, rawV2Logs: v2Logs.length, fromBlock: fromBlock.toString(), toBlock: scanTo.toString(), cachedPools: this.poolTokens.size }));
    }
    return { swaps, fromBlock, toBlock: scanTo };
  }

  getRecentSwaps(): NormalizedSwap[] { return [...this.recentSwaps]; }
  reset(): void { this.lastBlock = undefined; this.recentSwaps = []; this.poolTokens.clear(); this.seeded = false; }
  stop(): void { /* polling is owned by PaperTradingRuntime */ }
}
