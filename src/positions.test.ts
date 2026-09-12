import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PositionManager } from './positions.js';
import type { Position } from './domain.js';

function position(state: Position['state'] = 'DISCOVERED', id = 'POS-1'): Position {
  return {
    id,
    opportunityId: 'OPP-1',
    token: '0x0000000000000000000000000000000000002000',
    symbol: 'TEST',
    state,
    entryPriceUsd: 1,
    currentPriceUsd: 1,
    peakPriceUsd: 1,
    sizeUsd: 100,
    momentumAtEntry: 90,
    momentumPeak: 90,
    openedAt: 1,
    updatedAt: 1,
  };
}

test('enforces the position state machine', () => {
  const manager = new PositionManager();
  manager.add(position());
  manager.transition('POS-1', 'QUALIFIED');
  manager.transition('POS-1', 'SIGNAL');
  manager.transition('POS-1', 'ENTRY');
  manager.transition('POS-1', 'OPEN');
  assert.equal(manager.get('POS-1')?.state, 'OPEN');
  assert.throws(() => manager.transition('POS-1', 'QUALIFIED'));
});

test('emergency stop blocks new entries without closing positions', () => {
  const manager = new PositionManager();
  manager.add(position());
  manager.emergencyStopEntries();
  assert.equal(manager.canEnter(), false);
  assert.equal(manager.get('POS-1')?.state, 'DISCOVERED');
});

test('emergency close all closes active positions but leaves pre-entry candidates intact', () => {
  const manager = new PositionManager();
  manager.add(position('DISCOVERED', 'POS-1'));
  manager.add(position('QUALIFIED', 'POS-2'));
  manager.add(position('OPEN', 'POS-3'));
  manager.add(position('TRAILING', 'POS-4'));

  const closed = manager.emergencyCloseAll(1234);

  assert.deepEqual(closed.map((item) => item.id).sort(), ['POS-3', 'POS-4']);
  assert.equal(manager.listOpen().length, 0);
  assert.equal(manager.get('POS-1')?.state, 'DISCOVERED');
  assert.equal(manager.get('POS-2')?.state, 'QUALIFIED');
  assert.equal(manager.get('POS-3')?.updatedAt, 1234);
});
