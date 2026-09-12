import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, parseAbi } from 'viem';
import test from 'node:test';
import { decodePoolCreationLog, supportedPoolDiscovery } from './pool-discovery.js';
import type { DexDeployment } from './dex-registry.js';

const V3_ABI = parseAbi([
  'event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)',
]);

const V4_ABI = parseAbi([
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)',
]);

const deployment = (protocol: DexDeployment['protocol'], id: string): DexDeployment => ({
  id,
  name: id,
  protocol,
  chainId: 4663,
  enabled: true,
  verifiedAt: '2026-09-12',
});

test('pool discovery supports only protocols with verified event schemas', () => {
  assert.equal(supportedPoolDiscovery('uniswap-v2'), true);
  assert.equal(supportedPoolDiscovery('uniswap-v3'), true);
  assert.equal(supportedPoolDiscovery('uniswap-v4'), true);
  assert.equal(supportedPoolDiscovery('pons-v2'), false);
  assert.equal(supportedPoolDiscovery('ramses-v3'), false);
});

test('decodes a Uniswap V3 pool creation log', () => {
  const token0 = '0x0000000000000000000000000000000000000001' as const;
  const token1 = '0x0000000000000000000000000000000000000002' as const;
  const pool = '0x0000000000000000000000000000000000000003' as const;
  const topics = encodeEventTopics({
    abi: V3_ABI,
    eventName: 'PoolCreated',
    args: { token0, token1, fee: 3000 },
  });
  const data = encodeAbiParameters(
    [{ type: 'int24' }, { type: 'address' }],
    [60, pool],
  );

  const result = decodePoolCreationLog(deployment('uniswap-v3', 'uni-v3'), {
    topics,
    data,
    blockNumber: 123n,
  });

  assert.deepEqual(result, {
    dexId: 'uni-v3',
    protocol: 'uniswap-v3',
    pool,
    token0,
    token1,
    fee: 3000,
    tickSpacing: 60,
    blockNumber: 123n,
  });
});

test('decodes a Uniswap V4 initialize log as a pool id', () => {
  const id = `0x${'11'.repeat(32)}` as `0x${string}`;
  const token0 = '0x0000000000000000000000000000000000000001' as const;
  const token1 = '0x0000000000000000000000000000000000000002' as const;
  const hooks = '0x0000000000000000000000000000000000000004' as const;
  const topics = encodeEventTopics({
    abi: V4_ABI,
    eventName: 'Initialize',
    args: { id, currency0: token0, currency1: token1 },
  });
  const data = encodeAbiParameters(
    [{ type: 'uint24' }, { type: 'int24' }, { type: 'address' }, { type: 'uint160' }, { type: 'int24' }],
    [3000, 60, hooks, 1n, 0],
  );

  const result = decodePoolCreationLog(deployment('uniswap-v4', 'uni-v4'), { topics, data });

  assert.equal(result.pool, undefined);
  assert.equal(result.poolId, id);
  assert.equal(result.token0, token0);
  assert.equal(result.token1, token1);
  assert.equal(result.fee, 3000);
  assert.equal(result.tickSpacing, 60);
});
