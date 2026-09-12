import type { MomentumInput, MomentumResult } from './domain.js';

const clamp = (value: number): number => Math.max(0, Math.min(100, value));

/**
 * V1 weights agreed for PulseHood.
 * 25% price acceleration, 25% volume acceleration, 20% buy pressure,
 * 15% unique buyers, 10% liquidity, 5% breakout.
 */
export function calculateMomentum(input: MomentumInput): MomentumResult {
  const score = clamp(
    input.priceAcceleration * 0.25 +
    input.volumeAcceleration * 0.25 +
    input.buyPressure * 0.20 +
    input.uniqueBuyerScore * 0.15 +
    input.liquidityScore * 0.10 +
    input.breakoutScore * 0.05,
  );

  return {
    score,
    signal: score >= 80 ? 'BUY' : score >= 65 ? 'WATCH' : 'REJECT',
  };
}

export function momentumBand(score: number): 'exceptional' | 'strong' | 'candidate' | 'weak' {
  if (score >= 90) return 'exceptional';
  if (score >= 85) return 'strong';
  if (score >= 80) return 'candidate';
  return 'weak';
}
