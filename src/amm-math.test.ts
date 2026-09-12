import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteConstantProduct } from './amm-math.js';

test('constant-product quote charges fee before applying invariant', () => {
  const quote = quoteConstantProduct(100n, 10_000n, 20_000n, 30);
  assert.equal(quote.amountIn, 100n);
  assert.equal(quote.feeAmount, 1n);
  assert.equal(quote.amountOut, 196n);
  assert.equal(quote.reserveInAfter, 10_100n);
  assert.equal(quote.reserveOutAfter, 19_804n);
  assert.ok(quote.priceImpactBps > 0);
});

test('rejects empty liquidity and invalid fee configuration', () => {
  assert.throws(() => quoteConstantProduct(1n, 0n, 1n), /reserves/);
  assert.throws(() => quoteConstantProduct(1n, 1n, 1n, 10_000), /feeBps/);
  assert.throws(() => quoteConstantProduct(1n, 1n, 1n, 9_999), /amountIn is too small/);
});
