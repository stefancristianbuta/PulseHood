import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NormalizedSwap } from './swap-event.js';
import { FlowEngine } from './flow.js';

const token = '0x0000000000000000000000000000000000002000' as const;
const quote = '0x0000000000000000000000000000000000003000' as const;

function swap(direction: 'BUY' | 'SELL'): NormalizedSwap {
  return {
    status: 'normalized',
    protocol: 'test-dex',
    eventName: 'Swap',
    pool: '0x0000000000000000000000000000000000001000',
    transactionHash: `0x${'11'.repeat(32)}`,
    logIndex: 0,
    direction,
    targetToken: token,
    quoteToken: quote,
    amountIn: 1000n,
    amountOut: 900n,
    reason: undefined,
  };
}

test('aggregates buy pressure and unique buyers', () => {
  const engine = new FlowEngine();
  engine.process({ swap: swap('BUY'), trader: '0x0000000000000000000000000000000000004001', volumeUsd: 100, priceUsd: 1, timestampMs: 1000 });
  engine.process({ swap: swap('BUY'), trader: '0x0000000000000000000000000000000000004002', volumeUsd: 50, priceUsd: 1.02, timestampMs: 2000 });
  const snapshot = engine.process({ swap: swap('SELL'), trader: '0x0000000000000000000000000000000000004003', volumeUsd: 50, priceUsd: 1.01, timestampMs: 3000 });

  assert.ok(snapshot);
  assert.equal(snapshot.buyVolumeUsd, 150);
  assert.equal(snapshot.sellVolumeUsd, 50);
  assert.equal(snapshot.buyPressurePct, 75);
  assert.equal(snapshot.uniqueBuyers, 2);
  assert.equal(snapshot.uniqueSellers, 1);
  assert.equal(snapshot.volumeUsd, 200);
});

test('does not count repeated buyer activity as a new unique buyer', () => {
  const engine = new FlowEngine();
  const trader = '0x0000000000000000000000000000000000004001' as const;
  engine.process({ swap: swap('BUY'), trader, volumeUsd: 100, priceUsd: 1, timestampMs: 1000 });
  const snapshot = engine.process({ swap: swap('BUY'), trader, volumeUsd: 100, priceUsd: 1.01, timestampMs: 2000 });

  assert.ok(snapshot);
  assert.equal(snapshot.uniqueBuyers, 1);
  assert.equal(snapshot.buyVolumeUsd, 200);
});

test('starts a new one minute window', () => {
  const engine = new FlowEngine();
  engine.process({ swap: swap('BUY'), trader: '0x0000000000000000000000000000000000004001', volumeUsd: 100, priceUsd: 1, timestampMs: 1000 });
  const snapshot = engine.process({ swap: swap('BUY'), trader: '0x0000000000000000000000000000000000004002', volumeUsd: 250, priceUsd: 1.1, timestampMs: 61_000 });

  assert.ok(snapshot);
  assert.equal(snapshot.volumeUsd, 250);
  assert.equal(snapshot.uniqueBuyers, 1);
  assert.equal(snapshot.volumeAccelerationPct, 150);
});
