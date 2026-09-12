import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeSwapEvent, type PoolDescriptor } from './swap-event.js';
import type { DecodedEvent } from './decoder.js';

const pool: PoolDescriptor = {
  address: '0x0000000000000000000000000000000000001000',
  token0: '0x0000000000000000000000000000000000002000',
  token1: '0x0000000000000000000000000000000000003000',
  targetToken: '0x0000000000000000000000000000000000002000',
};

const base: DecodedEvent = {
  status: 'decoded',
  address: pool.address,
  transactionHash: `0x${'11'.repeat(32)}`,
  logIndex: 7,
  protocol: 'test-dex',
  eventName: 'Swap',
};

test('normalizes a direct tokenIn/tokenOut swap as BUY', () => {
  const result = normalizeSwapEvent({
    ...base,
    args: {
      tokenIn: pool.token1,
      tokenOut: pool.token0,
      amountIn: 1000n,
      amountOut: 900n,
    },
  }, pool);

  assert.equal(result.status, 'normalized');
  assert.equal(result.direction, 'BUY');
  assert.equal(result.amountIn, 1000n);
  assert.equal(result.amountOut, 900n);
});

test('normalizes a V2-style swap as SELL', () => {
  const result = normalizeSwapEvent({
    ...base,
    args: {
      amount0In: 1000n,
      amount1In: 0n,
      amount0Out: 0n,
      amount1Out: 900n,
    },
  }, pool);

  assert.equal(result.status, 'normalized');
  assert.equal(result.direction, 'SELL');
  assert.equal(result.amountIn, 1000n);
  assert.equal(result.amountOut, 900n);
});

test('normalizes a V3-style swap as BUY', () => {
  const result = normalizeSwapEvent({
    ...base,
    args: {
      amount0: -900n,
      amount1: 1000n,
      sqrtPriceX96: 1n,
      liquidity: 1n,
      tick: 1,
    },
  }, pool);

  assert.equal(result.status, 'normalized');
  assert.equal(result.direction, 'BUY');
  assert.equal(result.amountIn, 1000n);
  assert.equal(result.amountOut, 900n);
});
