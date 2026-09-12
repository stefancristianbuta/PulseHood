import { decodeEventLog, parseAbi, type PublicClient, type Transport } from 'viem';
import type { NormalizedSwap } from './swap-event.js';
import { normalizeSwapEvent } from './swap-event.js';

const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'.toLowerCase();
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'.toLowerCase();
const V2_FACTORY = '0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f' as `0x${string}`;
const V3_FACTORY = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa' as `0x${string}`;
const V2_SWAP = parseAbi(['event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)']);
const V3_SWAP = parseAbi(['event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)']);
const V2_FACTORY_ABI = parseAbi(['function allPairsLength() view returns (uint256)', 'function allPairs(uint256) view returns (address)']);
const V2_PAIR_ABI = parseAbi(['function token0() view returns (address)', 'function token1() view returns (address)']);
const V3_FACTORY_ABI = parseAbi(['event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)']);
const TOKEN_ABI = parseAbi(['function token0() view returns (address)', 'function token1() view returns (address)']);
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
  constructor(private readonly client: Client, private readonly maxRecentSwaps = 200) { this.start(); }
  private start(): void { if (this.running) return; this.running = true; void this.tick(); this.timer = setInterval(() => void this.tick(), 2_000); this.timer.unref(); }
  private addPool(address: `0x${string}`, protocol: PoolRef['protocol']): void { this.pools.set(address.toLowerCase(), { address, protocol }); }

  private async seedPools(toBlock: bigint): Promise<void> {
    if (this.seeded) return;
    this.seeded = true;
    try {
      const length = await this.client.readContract({ address: V2_FACTORY, abi: V2_FACTORY_ABI, functionName: 'allPairsLength' });
      const total = Number(length);
      const start = Math.max(0, total - 150);
      const indexes = Array.from({ length: total - start }, (_, i) => BigInt(start + i));
      const pairs = await Promise.all(indexes.map((index) => this.client.readContract({ address: V2_FACTORY, abi: V2_FACTORY_ABI, functionName: 'allPairs', args: [index] })));
      const tokenPairs = await Promise.all(pairs.map(async (pair) => { try { const [token0, token1] = await Promise.all([this.client.readContract({ address: pair as `0x${string}`, abi: V2_PAIR_ABI, functionName: 'token0' }), this.client.readContract({ address: pair as `0x${string}`, abi: V2_PAIR_ABI, functionName: 'token1' })]); return { pair: pair as `0x${string}`, token0: token0 as `0x${string}`, token1: token1 as `0x${string}` }; } catch { return undefined; } }));
      const quotePairs = tokenPairs.filter((pair): pair is { pair: `0x${string}`; token0: `0x${string}`; token1: `0x${string}` } => pair !== undefined && isQuote(pair.token0) !== isQuote(pair.token1));
      const selectedPairs = quotePairs.slice(-10);
      for (const pair of selectedPairs) { this.addPool(pair.pair, 'uniswap-v2'); this.poolTokens.set(pair.pair.toLowerCase(), { token0: pair.token0, token1: pair.token1 }); }
      console.log(JSON.stringify({ event: 'pool_seed_v2', totalPairs: total, inspectedPairs: pairs.length, quotePairs: quotePairs.length, selectedPools: selectedPairs.length }));
    } catch (error) { console.warn(JSON.stringify({ event: 'pool_seed_v2_error', message: error instanceof Error ? error.message : String(error) })); }
    try {
      const fromBlock = toBlock > 25n ? toBlock - 24n : 0n;
      const created = await this.client.getLogs({ address: V3_FACTORY, event: V3_FACTORY_ABI[0], fromBlock, toBlock });
      for (const log of created) { const args = log.args as { pool?: `0x${string}`; token0?: `0x${string}`; token1?: `0x${string}` }; if (args.pool && args.token0 && args.token1 && isQuote(args.token0) !== isQuote(args.token1)) { this.addPool(args.pool, 'uniswap-v3'); this.poolTokens.set(args.pool.toLowerCase(), { token0: args.token0, token1: args.token1 }); } }
      console.log(JSON.stringify({ event: 'pool_seed_v3', discoveredPools: created.length }));
    } catch (error) { console.warn(JSON.stringify({ event: 'pool_seed_v3_error', message: error instanceof Error ? error.message : String(error) })); }
  }

  private async discoverNewV3Pools(fromBlock: bigint, toBlock: bigint): Promise<void> { try { const logs = await this.client.getLogs({ address: V3_FACTORY, event: V3_FACTORY_ABI[0], fromBlock, toBlock }); for (const log of logs) { const args = log.args as { pool?: `0x${string}`; token0?: `0x${string}`; token1?: `0x${string}` }; if (args.pool && args.token0 && args.token1 && isQuote(args.token0) !== isQuote(args.token1)) { this.addPool(args.pool, 'uniswap-v3'); this.poolTokens.set(args.pool.toLowerCase(), { token0: args.token0, token1: args.token1 }); } } } catch (error) { console.warn(JSON.stringify({ event: 'pool_discovery_error', protocol: 'uniswap-v3', message: error instanceof Error ? error.message : String(error) })); } }

  private async tick(): Promise<void> {
    try {
      const toBlock = await this.client.getBlockNumber();
      await this.seedPools(toBlock);
      const result = await this.poll(toBlock, 25n);
      await this.discoverNewV3Pools(result?.fromBlock ?? (toBlock > 25n ? toBlock - 24n : 0n), toBlock);
      if (!result || result.swaps.length === 0) return;
      for (const swap of result.swaps.slice(-10)) console.log(JSON.stringify({ event: 'swap_ingested', block: result.toBlock.toString(), protocol: swap.protocol, pool: swap.pool, direction: swap.direction, targetToken: swap.targetToken, trader: swap.trader ?? null, transactionHash: swap.transactionHash, logIndex: swap.logIndex }));
      console.log(JSON.stringify({ event: 'swaps_ingested_batch', count: result.swaps.length, fromBlock: result.fromBlock.toString(), toBlock: result.toBlock.toString() }));
    } catch (error) { console.warn(JSON.stringify({ event: 'swap_ingest_error', message: error instanceof Error ? error.message : String(error) })); }
  }

  async poll(toBlock: bigint, maxRange = 50n): Promise<RadarIngestResult | undefined> {
    const fromBlock = this.lastBlock === undefined ? (toBlock > maxRange ? toBlock - maxRange + 1n : 0n) : this.lastBlock + 1n;
    if (fromBlock > toBlock) return undefined;
    const boundedFrom = toBlock - fromBlock + 1n > maxRange ? toBlock - maxRange + 1n : fromBlock;
    const poolRefs = [...this.pools.values()];
    if (poolRefs.length === 0) { this.lastBlock = toBlock; return { swaps: [], fromBlock: boundedFrom, toBlock }; }
    const addresses = poolRefs.map((pool) => pool.address);
    const [v2Logs, v3Logs] = await Promise.all([this.client.getLogs({ address: addresses, event: V2_SWAP[0], fromBlock: boundedFrom, toBlock }), this.client.getLogs({ address: addresses, event: V3_SWAP[0], fromBlock: boundedFrom, toBlock })]);
    const protocolByPool = new Map(poolRefs.map((pool) => [pool.address.toLowerCase(), pool.protocol]));
    const swaps: NormalizedSwap[] = [];
    const logs = [...v2Logs.map((log) => ({ log, protocol: protocolByPool.get(log.address.toLowerCase()) ?? 'uniswap-v2' as const, abi: V2_SWAP })), ...v3Logs.map((log) => ({ log, protocol: protocolByPool.get(log.address.toLowerCase()) ?? 'uniswap-v3' as const, abi: V3_SWAP }))];
    for (const { log, protocol, abi } of logs) {
      if (log.transactionHash === null || log.logIndex === undefined) continue;
      try {
        const pool = log.address.toLowerCase();
        let tokens = this.poolTokens.get(pool);
        if (tokens === undefined) { const [token0, token1] = await Promise.all([this.client.readContract({ address: log.address, abi: TOKEN_ABI, functionName: 'token0' }), this.client.readContract({ address: log.address, abi: TOKEN_ABI, functionName: 'token1' })]); tokens = { token0: token0 as `0x${string}`, token1: token1 as `0x${string}` }; this.poolTokens.set(pool, tokens); }
        const token0IsQuote = isQuote(tokens.token0); const token1IsQuote = isQuote(tokens.token1); if (token0IsQuote === token1IsQuote) continue;
        const targetToken = token0IsQuote ? tokens.token1 : tokens.token0;
        const decoded = decodeEventLog({ abi, topics: log.topics, data: log.data }); const args = decoded.args as Record<string, unknown>; const trader = typeof args.sender === 'string' && /^0x[0-9a-fA-F]{40}$/.test(args.sender) ? args.sender as `0x${string}` : undefined;
        const event: Parameters<typeof normalizeSwapEvent>[0] = { status: 'decoded', address: log.address, protocol, eventName: 'Swap', args, transactionHash: log.transactionHash, logIndex: Number(log.logIndex) };
        const normalized = normalizeSwapEvent(event, { address: log.address, token0: tokens.token0, token1: tokens.token1, targetToken }); if (normalized.status === 'normalized') swaps.push(trader === undefined ? normalized : { ...normalized, trader });
      } catch (error) { console.warn(JSON.stringify({ event: 'swap_log_decode_error', protocol, pool: log.address, transactionHash: log.transactionHash, logIndex: Number(log.logIndex), message: error instanceof Error ? error.message : String(error) })); }
    }
    this.lastBlock = toBlock; if (swaps.length > 0) this.recentSwaps = [...this.recentSwaps, ...swaps].slice(-this.maxRecentSwaps); return { swaps, fromBlock: boundedFrom, toBlock };
  }
  getRecentSwaps(): NormalizedSwap[] { return [...this.recentSwaps]; }
  reset(): void { this.lastBlock = undefined; this.recentSwaps = []; this.poolTokens.clear(); this.pools.clear(); this.seeded = false; }
  stop(): void { if (this.timer !== undefined) clearInterval(this.timer); this.timer = undefined; this.running = false; }
}
