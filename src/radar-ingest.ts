import { decodeEventLog, parseAbi, type PublicClient, type Transport } from 'viem';
import type { NormalizedSwap } from './swap-event.js';
import { normalizeSwapEvent } from './swap-event.js';

const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'.toLowerCase();
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'.toLowerCase();

const V2_SWAP = parseAbi([
  'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
]);

const V3_SWAP = parseAbi([
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
]);

const TOKEN_ABI = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
]);

type Client = PublicClient<Transport>;

interface PoolTokens {
  token0: `0x${string}`;
  token1: `0x${string}`;
}

export interface RadarIngestResult {
  swaps: NormalizedSwap[];
  fromBlock: bigint;
  toBlock: bigint;
}

function isQuote(token: `0x${string}`): boolean {
  const normalized = token.toLowerCase();
  return normalized === WETH || normalized === USDG;
}

export class RadarIngest {
  private readonly poolTokens = new Map<string, PoolTokens>();
  private lastBlock: bigint | undefined;
  private recentSwaps: NormalizedSwap[] = [];

  constructor(private readonly client: Client, private readonly maxRecentSwaps = 200) {}

  async poll(toBlock: bigint, maxRange = 50n): Promise<RadarIngestResult | undefined> {
    const fromBlock = this.lastBlock === undefined
      ? (toBlock > maxRange ? toBlock - maxRange + 1n : 0n)
      : this.lastBlock + 1n;
    if (fromBlock > toBlock) return undefined;

    const boundedFrom = toBlock - fromBlock + 1n > maxRange ? toBlock - maxRange + 1n : fromBlock;
    const [v2Logs, v3Logs] = await Promise.all([
      this.client.getLogs({ event: V2_SWAP[0], fromBlock: boundedFrom, toBlock }),
      this.client.getLogs({ event: V3_SWAP[0], fromBlock: boundedFrom, toBlock }),
    ]);

    const swaps: NormalizedSwap[] = [];
    const logs = [
      ...v2Logs.map((log) => ({ log, protocol: 'uniswap-v2' as const, abi: V2_SWAP })),
      ...v3Logs.map((log) => ({ log, protocol: 'uniswap-v3' as const, abi: V3_SWAP })),
    ];

    for (const { log, protocol, abi } of logs) {
      if (log.address === undefined || log.transactionHash === null || log.logIndex === undefined) continue;
      const pool = log.address.toLowerCase();
      let tokens = this.poolTokens.get(pool);
      if (tokens === undefined) {
        const [token0, token1] = await Promise.all([
          this.client.readContract({ address: log.address, abi: TOKEN_ABI, functionName: 'token0' }),
          this.client.readContract({ address: log.address, abi: TOKEN_ABI, functionName: 'token1' }),
        ]);
        tokens = { token0: token0 as `0x${string}`, token1: token1 as `0x${string}` };
        this.poolTokens.set(pool, tokens);
      }

      const token0IsQuote = isQuote(tokens.token0);
      const token1IsQuote = isQuote(tokens.token1);
      if (token0IsQuote === token1IsQuote) continue;

      const targetToken = token0IsQuote ? tokens.token1 : tokens.token0;
      const decoded = decodeEventLog({ abi, topics: log.topics, data: log.data });
      const args = decoded.args as Record<string, unknown>;
      const trader = typeof args.sender === 'string' && /^0x[0-9a-fA-F]{40}$/.test(args.sender)
        ? args.sender as `0x${string}`
        : undefined;

      const normalized = normalizeSwapEvent(
        {
          status: 'decoded',
          protocol,
          eventName: 'Swap',
          args,
          transactionHash: log.transactionHash,
          logIndex: Number(log.logIndex),
          reason: undefined,
        },
        { address: log.address, token0: tokens.token0, token1: tokens.token1, targetToken },
      );
      if (normalized.status === 'normalized') swaps.push({ ...normalized, trader });
    }

    this.lastBlock = toBlock;
    if (swaps.length > 0) this.recentSwaps = [...this.recentSwaps, ...swaps].slice(-this.maxRecentSwaps);
    return { swaps, fromBlock: boundedFrom, toBlock };
  }

  getRecentSwaps(): NormalizedSwap[] {
    return [...this.recentSwaps];
  }

  reset(): void {
    this.lastBlock = undefined;
    this.recentSwaps = [];
    this.poolTokens.clear();
  }
}
