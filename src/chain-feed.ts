import {
  createPublicClient,
  webSocket,
  type PublicClient,
  type Transport,
} from 'viem';
import { CHAIN } from './config.js';
import { TelemetryBus } from './telemetry.js';

export interface ChainBlock {
  number: bigint;
  hash: `0x${string}` | null;
  timestamp: bigint;
  transactionHashes: readonly `0x${string}`[];
}

export type ChainBlockHandler = (block: ChainBlock) => void | Promise<void>;

export class WebSocketChainFeed {
  private readonly client: PublicClient<Transport>;
  private unwatch: (() => void) | undefined;
  private readonly seenTransactions = new Set<`0x${string}`>();

  constructor(
    wsUrl: string,
    private readonly telemetry: TelemetryBus,
    private readonly maxSeenTransactions = 100_000,
  ) {
    if (!wsUrl.startsWith('wss://') && !wsUrl.startsWith('ws://')) {
      throw new Error('WebSocket chain feed URL must use ws:// or wss://');
    }
    this.client = createPublicClient({
      chain: CHAIN,
      transport: webSocket(wsUrl),
    }) as PublicClient<Transport>;
  }

  start(handler: ChainBlockHandler): void {
    if (this.unwatch !== undefined) return;

    this.unwatch = this.client.watchBlocks({
      emitOnBegin: false,
      emitMissed: true,
      includeTransactions: false,
      onBlock: async (block) => {
        const started = performance.now();
        const transactionHashes = await this.getNewTransactions(block.number);
        const normalized: ChainBlock = {
          number: block.number,
          hash: block.hash ?? null,
          timestamp: BigInt(block.timestamp),
          transactionHashes,
        };

        this.telemetry.emitEvent({
          correlationId: TelemetryBus.correlationId('BLOCK'),
          module: 'chain-feed',
          event: 'block',
          block: block.number,
          latencyMs: performance.now() - started,
          status: 'ok',
          payload: {
            transactionCount: transactionHashes.length,
            blockHash: block.hash ?? null,
          },
        });

        await handler(normalized);
      },
      onError: (error) => {
        this.telemetry.emitEvent({
          correlationId: TelemetryBus.correlationId('BLOCK'),
          module: 'chain-feed',
          event: 'subscription_error',
          status: 'error',
          payload: { error: error instanceof Error ? error.message : String(error) },
        });
      },
    });
  }

  stop(): void {
    this.unwatch?.();
    this.unwatch = undefined;
  }

  private async getNewTransactions(blockNumber: bigint): Promise<readonly `0x${string}`[]> {
    const block = await this.client.getBlock({ blockNumber, includeTransactions: false });
    const result: `0x${string}`[] = [];

    for (const hash of block.transactions) {
      if (this.seenTransactions.has(hash)) continue;
      this.seenTransactions.add(hash);
      result.push(hash);
    }

    while (this.seenTransactions.size > this.maxSeenTransactions) {
      const oldest = this.seenTransactions.values().next().value as `0x${string}` | undefined;
      if (oldest === undefined) break;
      this.seenTransactions.delete(oldest);
    }

    return result;
  }
}
