import assert from 'node:assert/strict';
import test from 'node:test';
import { DexScoringRegistry, scoreDex } from './dex.js';

const baseVenue = {
  id: 'a',
  name: 'A',
  family: 'uniswap-v3' as const,
  enabled: true,
  volume24hUsd: 100_000,
  liquidityUsd: 50_000,
  executionLatencyMs: 100,
  priceImpactBps: 20,
  recentActivityScore: 80,
};

test('DEX score follows the agreed weights and stays bounded', () => {
  const score = scoreDex(baseVenue, 100_000, 50_000);
  assert.ok(score >= 0 && score <= 100);
  assert.ok(score > 80);
});

test('scoring registry ranks enabled venues and excludes disabled venues', () => {
  const registry = new DexScoringRegistry();
  registry.upsert(baseVenue);
  registry.upsert({ ...baseVenue, id: 'b', name: 'B', volume24hUsd: 50_000, enabled: true });
  registry.upsert({ ...baseVenue, id: 'disabled', name: 'Disabled', enabled: false });

  const ranked = registry.ranked();
  assert.deepEqual(ranked.map((venue) => venue.id), ['a', 'b']);
  assert.ok(ranked[0]!.score > ranked[1]!.score);
});
