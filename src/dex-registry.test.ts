import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHAIN } from './config.js';
import { DEFAULT_DEX_REGISTRY, DexRegistry } from './dex-registry.js';

test('ships only verified Robinhood Chain DEX deployments by default', () => {
  const deployments = DEFAULT_DEX_REGISTRY.listEnabled();
  assert.equal(deployments.length, 4);
  assert.ok(deployments.every((deployment) => deployment.chainId === CHAIN.id));
  assert.equal(DEFAULT_DEX_REGISTRY.get('uniswap-v3-robinhood')?.factory, '0x1f7d7550b1b028f7571e69a784071f0205fd2efa');
  assert.equal(DEFAULT_DEX_REGISTRY.get('uniswap-v4-robinhood')?.poolManager, '0x8366a39cc670b4001a1121b8f6a443a643e40951');
  assert.equal(DEFAULT_DEX_REGISTRY.get('pons-v2-robinhood')?.hook, '0xe5e702641ea86f4ae6cc3cdaed2b886f976be044');
  assert.equal(DEFAULT_DEX_REGISTRY.get('ramses-v3-robinhood')?.factory, '0xe0c4ceb92d08ca985bb70fe0a22feb121a9854a8');
});

test('normalizes deployment addresses', () => {
  const registry = new DexRegistry([]);
  registry.register({
    id: 'test-dex',
    name: 'Test DEX',
    protocol: 'unknown',
    chainId: CHAIN.id,
    factory: '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD',
    enabled: true,
    verifiedAt: '2026-09-12',
  });
  assert.equal(registry.get('test-dex')?.factory, '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
});

test('supports dynamic registry additions while rejecting other chains', () => {
  const registry = new DexRegistry([]);
  registry.register({
    id: 'test-dex',
    name: 'Test DEX',
    protocol: 'unknown',
    chainId: CHAIN.id,
    enabled: true,
    verifiedAt: '2026-09-12',
  });
  assert.equal(registry.get('test-dex')?.name, 'Test DEX');
  assert.throws(() => registry.register({
    id: 'wrong-chain',
    name: 'Wrong Chain',
    protocol: 'unknown',
    chainId: 1,
    enabled: true,
    verifiedAt: '2026-09-12',
  }), /Unsupported DEX chain/);
});
