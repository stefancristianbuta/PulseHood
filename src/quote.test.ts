import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExecutionQuote } from './domain.js';
import { chooseBestQuote } from './quote.js';

function quote(dexId: string, expectedAmountOutUsd: number, latencyMs: number): ExecutionQuote {
  return {
    dexId,
    token: '0x0000000000000000000000000000000000002000',
    amountInUsd: 1000,
    expectedAmountOutUsd,
    executablePriceUsd: 1,
    dexFeeUsd: 2,
    slippageUsd: 1,
    priceImpactUsd: 1,
    gasEstimate: 100_000n,
    gasPriceWei: 1_000_000_000n,
    nativeTokenUsd: 3_000,
    quotedAt: 10_000,
    latencyMs,
  };
}

test('chooses the quote with the best net expected value', () => {
  const result = chooseBestQuote([quote('slow', 1100, 500), quote('fast', 1095, 20)], 10_100);
  assert.ok(result);
  assert.equal(result.quote.dexId, 'fast');
});

test('rejects stale quotes', () => {
  const result = chooseBestQuote([quote('stale', 1200, 10)], 20_000);
  assert.equal(result, undefined);
});

test('rejects excessive latency', () => {
  const result = chooseBestQuote([quote('slow', 1200, 2_000)], 10_100);
  assert.equal(result, undefined);
});
