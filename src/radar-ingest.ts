import { decodeEventLog, parseAbi, type PublicClient, type Transport } from 'viem';
import type { NormalizedSwap } from './swap-event.js';
import { normalizeSwapEvent } from './swap-event.js';

const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'.toLowerCase();
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'.toLowerCase();
const V2_FACTORY = '0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f' as `0x${string}`;
const V3_SWAP = parseAbi(['event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)']);
const V2_SWAP = parseAbi(['event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)']);
const V2_FACTORY_ABI = parseAbi(['function allPairsLength() view returns (uint256)', 'function allPairs(uint256) view returns (address)']);
const V2_PAIR_ABI = parseAbi(['function token0() view returns (address)', 'function token1() view returns (address)']);
const TOKEN_ABI = parseAbi(['function token0() view returns (address)', 'function token1() view returns (address)']);
const VERIFIED_ACTIVE_V3_POOLS: `0x${string}`[] = [
  '0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca',
  '0x7a192e71564ec66ee0763e328a3ac274942de4e1',
];
type Client = PublicClient<Transport>;
interface PoolTokens { token0: `0x${string}`; token1: `0x${string}`; }
interface PoolRef { address: `0x${string}`; protocol: 'uniswap-v2' | 'uniswap-v3'; }
export interface RadarIngestResult { swaps: NormalizedSwap[]; fromBlock: bigint; toBlock: bigint; }
function isQuote(token: `0x${string}`): boolean { const normalized = token.toLowerCase(); return normalized === WETH || normalized === USDG; }

export class RadarIngest {
  private readonly poolTokens = new Map<string, PoolTokens>();
  private readonly pools = new Map<string, PoolRef>();
  private lastBlock: bigint | undefined;
  private recentSwaps: NormalizedSwap[] = [];
  private running = false;
  private timer: NodeJS.Timeout | undefined;
  private seeded = false;
  constructor(private readonly client: Client, private readonly maxRecentSwaps = 200) {}
  private start(): void { if (this.running) return; this.running = true; void this.tick(); this.timer = setInterval(() => void this.tick(), 2_000); this.timer.unref(); }
  private addPool(address: `0x${string}`, protocol: PoolRef['protocol']): void { this.pools.set(address.toLowerCase(), { address, protocol }); }

  private async seedPools(): Promise<void> {
    if (this.seeded) return;
    for (const pool of VERIFIED_ACTIVE_V3_POOLS) this.addPool(pool, 'uniswap-v3');
    console.log(JSON.stringify({ event: 'pool_seed_v3_verified', selectedPools: VERIFIED_ACTIVE_V3_POOLS.length }));
    try {
      const length = await this.client.readContract({ address: V2_FACTORY, abi: V2_FACTORY_ABI, functionName: 'allPairsLength' });
      const total = Number(length);
      const start = Math.max(0, total - 20);
      const indexes = Array.from({ length: Math.max(0, total - start) }, (_, offset) => start + offset);
      const inspected = await Promise.all(indexes.map(async (index) => {
        try {
          const pair = await this.client.readContract({ address: V2_FACTORY, abi: V2_FACTORY_ABI, functionName: 'allPairs', args: [BigInt(index)] }) as `0x${string}`;
          const [token0, token1] = await Promise.all([
            this.client.readContract({ address: pair, abi: V2_PAIR_ABI, functionName: 'token0' }),
            this.client.readContract({ address: pair, abi: V2_PAIR_ABI, functionName: 'token1' }),
          ]);
          if (isQuote(token0 as `0x${string}`) !== isQuote(token1 as `0x${string}`)) return { pair, token0: token0 as `0x${string}`, token1: token1 as `0x${string}` };
        } catch (error) {
          console.warn(JSON.stringify({ event: 'pool_seed_v2_pair_error', index, message: error instanceof Error ? error.message : String(error) }));
        }
        return undefined;
      }));
      const selected = inspected.filter((value): value is { pair: `0x${string}`; token0: `0x${string}`; token1: `0x${string}` } => value !== undefined);
      for (const pair of selected.slice(-10)) { this.addPool(pair.pair, 'uniswap-v2'); this.poolTokens.set(pair.pair.toLowerCase(), { token0: pair.token0, token1: pair.token1 }); }
      console.log(JSON.stringify({ event: 'pool_seed_v2', totalPairs: total, inspectedPairs: indexes.length, quotePairs: selected.length, selectedPools: Math.min(10, selected.length) }));
    } catch (error) { console.warn(JSON.stringify({ event: 'pool_seed_v2_error', message: error instanceof Error ? error.message : String(error) })); }
    this.seeded = true;
  }

  private async tick(): Promise<void> {
    try {
      const head = await this.client.getBlockNumber();
      await this.seedPools();
      const result = await this.poll(head, 25n);
      if (!result || result.swaps.length === 0) return;
      for (const swap of result.swaps.slice(-10)) console.log(JSON.stringify({ event: 'swap_ingested', block: result.toBlock.toString(), protocol: swap.protocol, pool: swap.pool, direction: swap.direction, targetToken: swap.targetToken, trader: swap.trader ?? null, transactionHash: swap.transactionHash, logIndex: swap.logIndex }));
      console.log(JSON.stringify({ event: 'swaps_ingested_batch', count: result.swaps.length, fromBlock: result.fromBlock.toString(), toBlock: result.toBlock.toString() }));
    } catch (error) { console.warn(JSON.stringify({ event: 'swap_ingest_error', message: error instanceof Error ? error.message : String(error) })); }
  }

  private async getLogsAdaptive(poolRefs: PoolRef[], abi: readonly unknown[], fromBlock: bigint, toBlock: bigint) {
    const addresses = poolRefs.map((pool) => pool.address);
    const protocol = poolRefs[0]?.protocol ?? 'unknown';
    const fetchRange = async (from: bigint, to: bigint): Promise<any[]> => {
      try {
        return await this.client.getLogs({ address: addresses, event: abi[0] as never, fromBlock: from, toBlock: to });
      } catch (error) {
        if (from === to) throw error;
        const midpoint = from + ((to - from) / 2n);
        console.warn(JSON.stringify({ event: 'log_range_fallback', protocol, poolCount: poolRefs.length, fromBlock: from.toString(), toBlock: to.toString(), splitAt: midpoint.toString(), message: error instanceof Error ? error.message : String(error) }));
        const [left, right] = await Promise.all([fetchRange(from, midpoint), fetchRange(midpoint + 1n, to)]);
        return [...left, ...right];
      }
    };
    return fetchRange(fromBlock, toBlock);
  }

  async poll(toBlock: bigint, maxRange = 50n): Promise<RadarIngestResult | undefined> {
    if (this.lastBlock === undefined) this.lastBlock = toBlock > maxRange ? toBlock - maxRange : 0n;
    const fromBlock = this.lastBlock + 1n;
    if (fromBlock > toBlock) return undefined;
    const scanTo = fromBlock + maxRange - 1n < toBlock ? fromBlock + maxRange - 1n : toBlock;
    const poolRefs = [...this.pools.values()];
    if (poolRefs.length === 0) { this.lastBlock = scanTo; return { swaps: [], fromBlock, toBlock: scanTo }; }
    const groups = [poolRefs.filter((pool) => pool.protocol === 'uniswap-v2'), poolRefs.filter((pool) => pool.protocol === 'uniswap-v3')].filter((group) => group.length > 0);
    const logResults = await Promise.all(groups.map(async (group) => { const first = group[0]; if (first === undefined) throw new Error('Unexpected empty pool group'); const abi = first.protocol === 'uniswap-v2' ? V2_SWAP : V3_SWAP; const logs = await this.getLogsAdaptive(group, abi, fromBlock, scanTo); return { pools: group, abi, logs }; }));
    const protocolByPool = new Map(poolRefs.map((pool) => [pool.address.toLowerCase(), pool.protocol]));
    const swaps: NormalizedSwap[] = [];
    for (const { abi, logs } of logResults) {
      for (const log of logs) {
        if (log.transactionHash === null || log.logIndex === undefined) continue;
        try {
          const poolAddress = log.address.toLowerCase(); const protocol = protocolByPool.get(poolAddress); if (protocol === undefined) continue;
          let tokens = this.poolTokens.get(poolAddress);
          if (tokens === undefined) { const [token0, token1] = await Promise.all([this.client.readContract({ address: log.address, abi: TOKEN_ABI, functionName: 'token0' }), this.client.readContract({ address: log.address, abi: TOKEN_ABI, functionName: 'token1' })]); tokens = { token0: token0 as `0x${string}`, token1: token1 as `0x${string}` }; this.poolTokens.set(poolAddress, tokens); }
          const token0IsQuote = isQuote(tokens.token0); const token1IsQuote = isQuote(tokens.token1); if (token0IsQuote === token1IsQuote) continue;
          const targetToken = token0IsQuote ? tokens.token1 : tokens.token0;
          const decoded = decodeEventLog({ abi, topics: log.topics, data: log.data }); const args = decoded.args as Record<string, unknown>;
          const trader = typeof args.sender === 'string' && /^0x[0-9a-fA-F]{40}$/.test(args.sender) ? args.sender as `0x${string}` : undefined;
          const event: Parameters<typeof normalizeSwapEvent>[0] = { status: 'decoded', address: log.address, protocol, eventName: 'Swap', args, transactionHash: log.transactionHash, logIndex: Number(log.logIndex) };
          const normalized = normalizeSwapEvent(event, { address: log.address, token0: tokens.token0, token1: tokens.token1, targetToken });
          if (normalized.status === 'normalized') swaps.push(trader === undefined ? normalized : { ...normalized, trader });
        } catch (error) { console.warn(JSON.stringify({ event: 'swap_log_decode_error', protocol: protocolByPool.get(log.address.toLowerCase()) ?? 'unknown', pool: log.address, transactionHash: log.transactionHash, logIndex: Number(log.logIndex), message: error instanceof Error ? error.message : String(error) })); }
      }
    }
    this.lastBlock = scanTo;
    if (swaps.length > 0) this.recentSwaps = [...this.recentSwaps, ...swaps].slice(-this.maxRecentSwaps);
    return { swaps, fromBlock, toBlock: scanTo };
  }
  getRecentSwaps(): NormalizedSwap[] { return [...this.recentSwaps]; }
  reset(): void { this.lastBlock = undefined; this.recentSwaps = []; this.poolTokens.clear(); this.pools.clear(); this.seeded = false; }
  stop(): void { if (this.timer !== undefined) clearInterval(this.timer); this.timer = undefined; this.running = false; }
}
