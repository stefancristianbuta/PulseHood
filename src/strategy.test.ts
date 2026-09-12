import test from 'node:test';
import assert from 'node:assert/strict';
import { decideExit, qualifiesForEntry } from './strategy.js';

const position = {
  id: 'P1',
  opportunityId: 'OPP-TEST',
  token: '0x0000000000000000000000000000000000000001' as const,
  symbol: 'TEST',
  state: 'OPEN' as const,
  entryPriceUsd: 1,
  currentPriceUsd: 1.5,
  peakPriceUsd: 1.6,
  sizeUsd: 100,
  momentumAtEntry: 91,
  momentumPeak: 98,
  openedAt: Date.now(),
  updatedAt: Date.now(),
};

test('entry policy requires all V1 conditions', () => {
  assert.equal(qualifiesForEntry({
    momentum: { score: 89, signal: 'BUY' },
    riskScore: 20,
    liquidityUsd: 100_000,
    uniqueBuyerScore: 80,
    buyPressurePct: 70,
    volumeAcceleration: 10,
    breakoutConfirmed: true,
    minLiquidityUsd: 50_000,
    minUniqueBuyerScore: 60,
  }), true);

  assert.equal(qualifiesForEntry({
    momentum: { score: 89, signal: 'BUY' },
    riskScore: 31,
    liquidityUsd: 100_000,
    uniqueBuyerScore: 80,
    buyPressurePct: 70,
    volumeAcceleration: 10,
    breakoutConfirmed: true,
    minLiquidityUsd: 50_000,
    minUniqueBuyerScore: 60,
  }), false);
});

test('exit holds while momentum remains strong', () => {
  const decision = decideExit(position, {
    priceUsd: 1.55,
    momentum: 96,
    volumeAcceleration: 12,
    timestamp: Date.now(),
  });
  assert.equal(decision.action, 'HOLD');
});

test('exit tightens when momentum deteriorates', () => {
  const decision = decideExit(position, {
    priceUsd: 1.56,
    momentum: 82,
    volumeAcceleration: 0,
    timestamp: Date.now(),
  });
  assert.equal(decision.action, 'TIGHTEN');
});

test('exit sells after severe momentum deterioration', () => {
  const decision = decideExit(position, {
    priceUsd: 1.5,
    momentum: 67,
    volumeAcceleration: -30,
    timestamp: Date.now(),
  });
  assert.equal(decision.action, 'SELL');
});
