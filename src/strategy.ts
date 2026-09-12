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

export function qualifiesForEntry(input: EntryPolicyInput): boolean {
  return (
    input.momentum.score >= 80 &&
    input.riskScore <= 30 &&
    input.liquidityUsd >= input.minLiquidityUsd &&
    input.uniqueBuyerScore >= input.minUniqueBuyerScore &&
    input.buyPressurePct >= 62 &&
    input.volumeAcceleration > 0 &&
    input.breakoutConfirmed
  );
}

export interface ExitPolicyConfig {
  tightenMomentumDrop: number;
  sellMomentumDrop: number;
  baseTrailingPct: number;
  tightTrailingPct: number;
  maxVolumeDeterioration: number;
}

export const DEFAULT_EXIT_POLICY: ExitPolicyConfig = {
  tightenMomentumDrop: 15,
  sellMomentumDrop: 30,
  baseTrailingPct: 8,
  tightTrailingPct: 4,
  maxVolumeDeterioration: -20,
};

export function decideExit(
  position: Position,
  market: MarketUpdate,
  config: ExitPolicyConfig = DEFAULT_EXIT_POLICY,
): ExitDecision {
  const momentumDrop = position.momentumPeak - market.momentum;
  const retracementPct = position.peakPriceUsd > 0
    ? ((position.peakPriceUsd - market.priceUsd) / position.peakPriceUsd) * 100
    : 0;

  if (momentumDrop >= config.sellMomentumDrop) {
    return {
      action: 'SELL',
      reason: `momentum deterioration ${momentumDrop.toFixed(1)} points`,
      trailingDistancePct: config.tightTrailingPct,
    };
  }

  if (momentumDrop >= config.tightenMomentumDrop || market.volumeAcceleration <= config.maxVolumeDeterioration) {
    if (retracementPct >= config.tightTrailingPct) {
      return {
        action: 'SELL',
        reason: `tight trailing triggered after ${retracementPct.toFixed(1)}% retracement`,
        trailingDistancePct: config.tightTrailingPct,
      };
    }
    return {
      action: 'TIGHTEN',
      reason: 'momentum or volume deterioration detected',
      trailingDistancePct: config.tightTrailingPct,
    };
  }

  if (retracementPct >= config.baseTrailingPct) {
    return {
      action: 'SELL',
      reason: `base trailing triggered after ${retracementPct.toFixed(1)}% retracement`,
      trailingDistancePct: config.baseTrailingPct,
    };
  }

  return {
    action: 'HOLD',
    reason: 'momentum remains constructive',
    trailingDistancePct: config.baseTrailingPct,
  };
}
