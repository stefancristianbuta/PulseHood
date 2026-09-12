import type { ExecutionQuote, ExecutionResult, PaperCost, PaperFill } from './domain.js';
import { TelemetryBus } from './telemetry.js';

export interface ExecutionOrder {
  side: 'BUY' | 'SELL';
  token: `0x${string}`;
  amountUsd: number;
  quote: ExecutionQuote;
  correlationId: string;
}

export interface ExecutionEngine {
  buy(order: ExecutionOrder): Promise<ExecutionResult>;
  sell(order: ExecutionOrder): Promise<ExecutionResult>;
  cancel(orderId: string): Promise<void>;
}

export class PaperExecutionEngine implements ExecutionEngine {
  constructor(private readonly telemetry: TelemetryBus) {}

  async buy(order: ExecutionOrder): Promise<ExecutionResult> {
    return this.execute(order);
  }

  async sell(order: ExecutionOrder): Promise<ExecutionResult> {
    return this.execute(order);
  }

  async cancel(orderId: string): Promise<void> {
    this.telemetry.emitEvent({
      correlationId: TelemetryBus.correlationId('CANCEL'),
      module: 'execution',
      event: 'paper_cancel',
      status: 'ok',
      payload: { orderId },
    });
  }

  private async execute(order: ExecutionOrder): Promise<ExecutionResult> {
    const started = performance.now();
    const gasEth = Number(order.quote.gasEstimate * order.quote.gasPriceWei) / 1e18;
    const gasUsd = gasEth * order.quote.nativeTokenUsd;
    const dexFeeUsd = Math.max(0, order.quote.dexFeeUsd);
    const priceImpactUsd = Math.max(0, order.quote.priceImpactUsd);
    const slippageUsd = Math.max(0, order.amountUsd - order.quote.expectedAmountOutUsd);
    const cost: PaperCost = {
      dexFeeUsd,
      gasUsd,
      slippageUsd,
      priceImpactUsd,
      totalUsd: dexFeeUsd + gasUsd + slippageUsd + priceImpactUsd,
    };

    const fill: PaperFill = {
      side: order.side,
      requestedUsd: order.amountUsd,
      executedUsd: Math.max(0, order.quote.expectedAmountOutUsd - priceImpactUsd),
      executionPriceUsd: order.quote.executablePriceUsd,
      cost,
      timestamp: Date.now(),
    };

    this.telemetry.emitEvent({
      correlationId: order.correlationId,
      module: 'execution',
      event: 'paper_fill',
      token: order.token,
      latencyMs: performance.now() - started,
      status: 'ok',
      payload: {
        side: order.side,
        dexId: order.quote.dexId,
        requestedUsd: order.amountUsd,
        executedUsd: fill.executedUsd,
        totalCostUsd: cost.totalUsd,
        gasUsd,
      },
    });

    return { fill, quote: order.quote };
  }
}
