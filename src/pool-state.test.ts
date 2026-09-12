import assert from 'node:assert/strict';
import test from 'node:test';
import { readPoolState, supportsPoolState } from './pool-state.js';
import type { DiscoveredPool } from './pool-discovery.js';

test('pool state support is limited to verified V2 and V3 readers', () => {
  assert.equal(supportsPoolState('uniswap-v2'), true);
  assert.equal(supportsPoolState('uniswap-v3'), true);
  assert.equal(supportsPoolState('uniswap-v4'), false);
  assert.equal(supportsPoolState('pons-v2'), false);
  assert.equal(supportsPoolState('ramses-v3'), false);
});

test('reads Uniswap V2 reserves and token addresses', async () => {
  const pool = '0x0000000000000000000000000000000000000010' as const;
  const token0 = '0x0000000000000000000000000000000000000011' as const;
  const token1 = '0x0000000000000000000000000000000000000012' as const;
  const client = {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === 'getReserves') return [1000n, 2000n, 1234567890];
      if (functionName === 'token0') return token0;
      if (functionName === 'token1') return token1;
      throw new Error('unexpected call');
    },
  };

  const result = await readPoolState(client as never, {
    dexId: 'uni-v2',
    protocol: 'uniswap-v2',
    pool,
    token0,
    token1,
  } satisfies DiscoveredPool);

  assert.deepEqual(result, {
    kind: 'v2',
    pool,
    token0,
    token1,
    reserve0: 1000n,
    reserve1: 2000n,
    blockTimestampLast: 1234567890,
  });
});

test('reads Uniswap V3 slot0 and liquidity', async () => {
  const pool = '0x0000000000000000000000000000000000000020' as const;
  const token0 = '0x0000000000000000000000000000000000000021' as const;
  const token1 = '0x0000000000000000000000000000000000000022' as const;
  const client = {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === 'slot0') return [79228162514264337593543950336n, -60, 1, 2, 3, 4, true];
      if (functionName === 'liquidity') return 500000n;
      if (functionName === 'token0') return token0;
      if (functionName === 'token1') return token1;
      throw new Error('unexpected call');
    },
  };

  const result = await readPoolState(client as never, {
    dexId: 'uni-v3',
    protocol: 'uniswap-v3',
    pool,
    token0,
    token1,
    fee: 3000,
    tickSpacing: 60,
  } satisfies DiscoveredPool);

  assert.deepEqual(result, {
    kind: 'v3',
    pool,
    token0,
    token1,
    sqrtPriceX96: 79228162514264337593543950336n,
    tick: -60,
    liquidity: 500000n,
    observationIndex: 1,
    observationCardinality: 2,
    observationCardinalityNext: 3,
    feeProtocol: 4,
    unlocked: true,
  });
});

test('rejects pool ids without an address-backed state reader', async () => {
  await assert.rejects(
    readPoolState({} as never, {
      dexId: 'uni-v4',
      protocol: 'uniswap-v4',
      poolId: `0x${'11'.repeat(32)}` as `0x${string}`,
      token0: '0x0000000000000000000000000000000000000001',
      token1: '0x0000000000000000000000000000000000000002',
    }),
    /address-backed pool/,
  );
});
