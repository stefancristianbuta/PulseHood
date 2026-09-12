import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateSignal } from './signal.js';
import type { FlowSnapshot } from './flow.js';

const token = '0x0000000000000000000000000000000000002000' as const;

function flow(overrides: Partial<FlowSnapshot> = {}): FlowSnapshot {
  return {
    token,
    windowStartMs: 0,
    buyVolumeUsd: 900,
    sellVolumeUsd: 300,
    volumeUsd: 1200,
    buyPressurePct: 75,
    buyCount: 12,
    sellCount: 4,
    uniqueBuyers: 12,
    uniqueSellers: 4,
    uniqueBuyerDeltaPct: 50,
    volumeAccelerationPct: 40,
    priceUsd: 1.4,
    previousPriceUsd: 1.2,
    priceChangePct: 16.67,
    ...overrides,
  };
}

test('produces a BUY candidate when entry criteria are satisfied', () => {
  const result = evaluateSignal({ flow: flow(), riskScore: 20, liquidityScore: 90, breakoutScore: 90, liquidityUsd: 100_000, minLiquidityUsd: 10_000, minUniqueBuyerScore: 50 });
  assert.equal(result.signal, 'BUY');
  assert.equal(result.entryQualified, true);
  assert.equal(result.risk.tradable, true);
});

test('rejects an otherwise strong flow when risk is above the trading limit', () => {
  const result = evaluateSignal({ flow: flow(), riskScore: 51, liquidityScore: 90, breakoutScore: 90, liquidityUsd: 100_000, minLiquidityUsd: 10_000, minUniqueBuyerScore: 50 });
  assert.equal(result.risk.tradable, false);
  assert.equal(result.entryQualified, false);
  assert.equal(result.signal, 'REJECT');
});

test('keeps a constructive but incomplete setup on WATCH', () => {
  const result = evaluateSignal({ flow: flow({ buyPressurePct: 65 }), riskScore: 20, liquidityScore: 90, breakoutScore: 40, liquidityUsd: 100_000, minLiquidityUsd: 10_000, minUniqueBuyerScore: 50 });
  assert.equal(result.entryQualified, false);
  assert.equal(result.signal, 'WATCH');
});
