import assert from 'node:assert/strict';
import test from 'node:test';
import { TelemetryBus } from './telemetry.js';

test('telemetry emits unique event ids and preserves correlation ids', () => {
  const telemetry = new TelemetryBus();
  const events: string[] = [];
  const correlationId = 'OPP-TEST-001';
  const stop = telemetry.onEvent((event) => {
    assert.equal(event.correlationId, correlationId);
    assert.equal(typeof event.eventId, 'string');
    assert.equal(typeof event.timestampNs, 'bigint');
    events.push(event.eventId);
  });

  const first = telemetry.emitEvent({ module: 'test', event: 'one', status: 'ok', correlationId });
  const second = telemetry.emitEvent({ module: 'test', event: 'two', status: 'ok', correlationId });
  stop();

  assert.equal(events.length, 2);
  assert.notEqual(first.eventId, second.eventId);
});
