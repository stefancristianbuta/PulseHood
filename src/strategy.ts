import type { ExitDecision, MarketUpdate, MomentumResult, Position } from './domain.js';

export interface EntryPolicyInput {
  momentum: MomentumResult;
  riskScore: number;
  liquidityUsd: number;
  uniqueBuyerScore: number;
  buyPressurePct: number;
  volumeAcceleration: number;
  breakoutConfirmed: boolean;
  minLiquidityUsd: number;
  minUniqueBuyerScore: number;
}

export const V2_ENTRY_DEFAULTS = {
  minMomentum: 78,
  maxRisk: 20,
  minLiquidityUsd: 30_000,
  minUniqueBuyerScore: 40,
  minBuyPressurePct: 68,
  minVolumeAccelerationPct: 10,
};

export function qualifiesForEntry(input: EntryPolicyInput): boolean {
  return input.momentum.score >= V2_ENTRY_DEFAULTS.minMomentum &&
    input.riskScore <= V2_ENTRY_DEFAULTS.maxRisk &&
    input.liquidityUsd >= Math.max(V2_ENTRY_DEFAULTS.minLiquidityUsd, input.minLiquidityUsd) &&
    input.uniqueBuyerScore >= Math.max(V2_ENTRY_DEFAULTS.minUniqueBuyerScore, input.minUniqueBuyerScore) &&
    input.buyPressurePct >= V2_ENTRY_DEFAULTS.minBuyPressurePct &&
    input.volumeAcceleration >= V2_ENTRY_DEFAULTS.minVolumeAccelerationPct &&
    input.breakoutConfirmed;
}

export interface ExitPolicyConfig {
  tightenMomentumDrop: number;
  sellMomentumDrop: number;
  baseTrailingPct: number;
  tightTrailingPct: number;
  maxVolumeDeterioration: number;
  earlyMomentumDrop: number;
}

export const DEFAULT_EXIT_POLICY: ExitPolicyConfig = {
  tightenMomentumDrop: 8,
  sellMomentumDrop: 16,
  baseTrailingPct: 5,
  tightTrailingPct: 2.5,
  maxVolumeDeterioration: -8,
  earlyMomentumDrop: 8,
};

export function decideExit(position: Position, market: MarketUpdate, config: ExitPolicyConfig = DEFAULT_EXIT_POLICY): ExitDecision {
  const momentumDrop = position.momentumPeak - market.momentum;
  const retracementPct = position.peakPriceUsd > 0 ? ((position.peakPriceUsd - market.priceUsd) / position.peakPriceUsd) * 100 : 0;
  if (momentumDrop >= config.sellMomentumDrop) return { action: 'SELL', reason: `momentum deterioration ${momentumDrop.toFixed(1)} points`, trailingDistancePct: config.tightTrailingPct };
  if (momentumDrop >= config.tightenMomentumDrop || market.volumeAcceleration <= config.maxVolumeDeterioration) {
    if (retracementPct >= config.tightTrailingPct) return { action: 'SELL', reason: `tight trailing triggered after ${retracementPct.toFixed(1)}% retracement`, trailingDistancePct: config.tightTrailingPct };
    return { action: 'TIGHTEN', reason: 'momentum or volume deterioration detected', trailingDistancePct: config.tightTrailingPct };
  }
  if (retracementPct >= config.baseTrailingPct) return { action: 'SELL', reason: `base trailing triggered after ${retracementPct.toFixed(1)}% retracement`, trailingDistancePct: config.baseTrailingPct };
  return { action: 'HOLD', reason: 'momentum remains constructive', trailingDistancePct: config.baseTrailingPct };
}
