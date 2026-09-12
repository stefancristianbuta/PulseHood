import type { ExecutionQuote } from './domain.js';

export interface ScoredQuote {
  quote: ExecutionQuote;
  gasUsd: number;
  latencyPenaltyUsd: number;
  totalCostUsd: number;
  netExpectedUsd: number;
}

export interface QuoteSelectionConfig {
  maxQuoteAgeMs: number;
  maxLatencyMs: number;
  latencyPenaltyUsdPerMs: number;
}

export const DEFAULT_QUOTE_SELECTION: QuoteSelectionConfig = {
  maxQuoteAgeMs: 2_000,
  maxLatencyMs: 1_500,
  latencyPenaltyUsdPerMs: 0.001,
};

function gasUsd(quote: ExecutionQuote): number {
  return Number(quote.gasEstimate * quote.gasPriceWei) / 1e18 * quote.nativeTokenUsd;
}

export function scoreQuote(quote: ExecutionQuote, now = Date.now(), config: QuoteSelectionConfig = DEFAULT_QUOTE_SELECTION): ScoredQuote | undefined {
  const age = now - quote.quotedAt;
  if (age < 0 || age > config.maxQuoteAgeMs) return undefined;
  if (!Number.isFinite(quote.latencyMs) || quote.latencyMs > config.maxLatencyMs) return undefined;

  const gas = Math.max(0, gasUsd(quote));
  const dexFee = Math.max(0, quote.dexFeeUsd);
  const slippage = Math.max(0, quote.slippageUsd);
  const impact = Math.max(0, quote.priceImpactUsd);
  const latencyPenalty = Math.max(0, quote.latencyMs) * Math.max(0, config.latencyPenaltyUsdPerMs);
  const totalCostUsd = dexFee + gas + slippage + impact;

  return {
    quote,
    gasUsd: gas,
    latencyPenaltyUsd: latencyPenalty,
    totalCostUsd,
    netExpectedUsd: quote.expectedAmountOutUsd - totalCostUsd - latencyPenalty,
  };
}

export function chooseBestQuote(quotes: readonly ExecutionQuote[], now = Date.now(), config: QuoteSelectionConfig = DEFAULT_QUOTE_SELECTION): ScoredQuote | undefined {
  let best: ScoredQuote | undefined;
  for (const quote of quotes) {
    const scored = scoreQuote(quote, now, config);
    if (scored === undefined) continue;
    if (best === undefined || scored.netExpectedUsd > best.netExpectedUsd) best = scored;
  }
  return best;
}
