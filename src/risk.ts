import type { RiskResult } from './domain.js';

/**
 * V1 policy: 0-30 tradable, 31-50 watch, 51+ reject.
 * The detailed on-chain checks will feed this aggregator in the next stage.
 */
export function classifyRisk(score: number): RiskResult {
  const normalized = Math.max(0, Math.min(100, score));
  return { score: normalized, tradable: normalized <= 30 };
}
