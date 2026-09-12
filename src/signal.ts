import { calculateMomentum } from './momentum.js';
import { classifyRisk } from './risk.js';
import { qualifiesForEntry, type EntryPolicyInput } from './strategy.js';
import type { FlowSnapshot } from './flow.js';
import type { MomentumInput, MomentumResult, RiskResult, Signal } from './domain.js';

export interface SignalInput {
  flow: FlowSnapshot;
  riskScore: number;
  liquidityScore: number;
  breakoutScore: number;
  liquidityUsd: number;
  minLiquidityUsd: number;
  minUniqueBuyerScore: number;
}

export interface SignalResult {
  signal: Signal;
  momentum: MomentumResult;
  risk: RiskResult;
  entryQualified: boolean;
  momentumInput: MomentumInput;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function evaluateSignal(input: SignalInput): SignalResult {
  const momentumInput: MomentumInput = {
    priceAcceleration: clamp(Math.max(0, input.flow.priceChangePct) * 4),
    volumeAcceleration: clamp(50 + input.flow.volumeAccelerationPct / 2),
    buyPressure: clamp(input.flow.buyPressurePct),
    uniqueBuyerScore: clamp(Math.min(100, input.flow.uniqueBuyers * 10 + Math.max(0, input.flow.uniqueBuyerDeltaPct) * 0.5)),
    liquidityScore: clamp(input.liquidityScore),
    breakoutScore: clamp(input.breakoutScore),
  };

  const momentum = calculateMomentum(momentumInput);
  const risk = classifyRisk(input.riskScore);
  const entryInput: EntryPolicyInput = {
    momentum,
    riskScore: risk.score,
    liquidityUsd: input.liquidityUsd,
    uniqueBuyerScore: momentumInput.uniqueBuyerScore,
    buyPressurePct: input.flow.buyPressurePct,
    volumeAcceleration: input.flow.volumeAccelerationPct,
    breakoutConfirmed: input.breakoutScore >= 70,
    minLiquidityUsd: input.minLiquidityUsd,
    minUniqueBuyerScore: input.minUniqueBuyerScore,
  };

  const entryQualified = qualifiesForEntry(entryInput);
  const signal: Signal = entryQualified
    ? 'BUY'
    : momentum.score >= 65 && risk.tradable
      ? 'WATCH'
      : 'REJECT';

  return { signal, momentum, risk, entryQualified, momentumInput };
}
