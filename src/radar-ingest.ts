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
  private running = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly client: Client, private readonly maxRecentSwaps = 200) {
    this.start();
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 2_000);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    try {
      const toBlock = await this.client.getBlockNumber();
      const result = await this.poll(toBlock, 25n);
      if (result === undefined) return;
      if (result.swaps.length > 0) {
        for (const swap of result.swaps.slice(-10)) {
          console.log(JSON.stringify({
            event: 'swap_ingested',
            block: result.toBlock.toString(),
            protocol: swap.protocol,
            pool: swap.pool,
            direction: swap.direction,
            targetToken: swap.targetToken,
            trader: swap.trader ?? null,
            transactionHash: swap.transactionHash,
            logIndex: swap.logIndex,
          }));
        }
        console.log(JSON.stringify({ event: 'swaps_ingested_batch', count: result.swaps.length, fromBlock: result.fromBlock.toString(), toBlock: result.toBlock.toString() }));
      }
    } catch (error) {
      console.warn(JSON.stringify({
        event: 'swap_ingest_error',
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }

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
      if (log.transactionHash === null || log.logIndex === undefined) continue;
      try {
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

        const event: Parameters<typeof normalizeSwapEvent>[0] = {
          status: 'decoded',
          address: log.address,
          protocol,
          eventName: 'Swap',
          args,
          transactionHash: log.transactionHash,
          logIndex: Number(log.logIndex),
        };

        const normalized = normalizeSwapEvent(event, {
          address: log.address,
          token0: tokens.token0,
          token1: tokens.token1,
          targetToken,
        });
        if (normalized.status === 'normalized') {
          swaps.push(trader === undefined ? normalized : { ...normalized, trader });
        }
      } catch (error) {
        console.warn(JSON.stringify({
          event: 'swap_log_decode_error',
          protocol,
          pool: log.address,
          transactionHash: log.transactionHash,
          logIndex: Number(log.logIndex),
          message: error instanceof Error ? error.message : String(error),
        }));
      }
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

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.running = false;
  }
}
