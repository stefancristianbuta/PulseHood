import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExecutionQuote } from './domain.js';
import { PaperExecutionEngine } from './execution.js';
import { TelemetryBus } from './telemetry.js';

const quote: ExecutionQuote = {
  dexId: 'test-dex',
  token: '0x0000000000000000000000000000000000002000',
  amountInUsd: 1000,
  expectedAmountOutUsd: 1100,
  executablePriceUsd: 1.1,
  dexFeeUsd: 5,
  slippageUsd: 3,
  priceImpactUsd: 2,
  gasEstimate: 100_000n,
  gasPriceWei: 1_000_000_000n,
  nativeTokenUsd: 3000,
  quotedAt: Date.now(),
  latencyMs: 20,
};

test('paper execution includes all simulated execution costs once', async () => {
  const telemetry = new TelemetryBus();
  const events: string[] = [];
  telemetry.onEvent((event) => events.push(event.event));
  const engine = new PaperExecutionEngine(telemetry);

  const result = await engine.buy({
    side: 'BUY',
    token: quote.token,
    amountUsd: 1000,
    quote,
    correlationId: 'OPP-TEST-001',
  });

  assert.equal(result.fill.cost.dexFeeUsd, 5);
  assert.equal(result.fill.cost.slippageUsd, 3);
  assert.equal(result.fill.cost.priceImpactUsd, 2);
  assert.equal(result.fill.cost.gasUsd, 0.3);
  assert.equal(result.fill.cost.totalUsd, 10.3);
  assert.equal(result.fill.executedUsd, 1089.7);
  assert.deepEqual(events, ['paper_fill']);
});

test('cancel is telemetry-only and never creates a fill', async () => {
  const telemetry = new TelemetryBus();
  const events: string[] = [];
  telemetry.onEvent((event) => events.push(event.event));
  const engine = new PaperExecutionEngine(telemetry);
  await engine.cancel('ORDER-1');
  assert.deepEqual(events, ['paper_cancel']);
});
