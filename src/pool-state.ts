import { parseAbi, type PublicClient } from 'viem';
import type { DiscoveredPool } from './pool-discovery.js';

const V2_PAIR_ABI = parseAbi([
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
]);

const V3_POOL_ABI = parseAbi([
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() view returns (uint128)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
]);

export interface V2PoolState {
  kind: 'v2';
  pool: `0x${string}`;
  token0: `0x${string}`;
  token1: `0x${string}`;
  reserve0: bigint;
  reserve1: bigint;
  blockTimestampLast: number;
}

export interface V3PoolState {
  kind: 'v3';
  pool: `0x${string}`;
  token0: `0x${string}`;
  token1: `0x${string}`;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  observationIndex: number;
  observationCardinality: number;
  observationCardinalityNext: number;
  feeProtocol: number;
  unlocked: boolean;
}

export type PoolState = V2PoolState | V3PoolState;

export function supportsPoolState(protocol: DiscoveredPool['protocol']): boolean {
  return protocol === 'uniswap-v2' || protocol === 'uniswap-v3';
}

export async function readPoolState(
  client: PublicClient,
  pool: DiscoveredPool,
): Promise<PoolState> {
  if (!pool.pool) throw new Error('Pool state requires an address-backed pool');

  if (pool.protocol === 'uniswap-v2') {
    const [reserves, token0, token1] = await Promise.all([
      client.readContract({ address: pool.pool, abi: V2_PAIR_ABI, functionName: 'getReserves' }),
      client.readContract({ address: pool.pool, abi: V2_PAIR_ABI, functionName: 'token0' }),
      client.readContract({ address: pool.pool, abi: V2_PAIR_ABI, functionName: 'token1' }),
    ]);

    return {
      kind: 'v2',
      pool: pool.pool,
      token0,
      token1,
      reserve0: reserves[0],
      reserve1: reserves[1],
      blockTimestampLast: reserves[2],
    };
  }

  if (pool.protocol === 'uniswap-v3') {
    const [slot0, liquidity, token0, token1] = await Promise.all([
      client.readContract({ address: pool.pool, abi: V3_POOL_ABI, functionName: 'slot0' }),
      client.readContract({ address: pool.pool, abi: V3_POOL_ABI, functionName: 'liquidity' }),
      client.readContract({ address: pool.pool, abi: V3_POOL_ABI, functionName: 'token0' }),
      client.readContract({ address: pool.pool, abi: V3_POOL_ABI, functionName: 'token1' }),
    ]);

    return {
      kind: 'v3',
      pool: pool.pool,
      token0,
      token1,
      sqrtPriceX96: slot0[0],
      tick: slot0[1],
      liquidity,
      observationIndex: slot0[2],
      observationCardinality: slot0[3],
      observationCardinalityNext: slot0[4],
      feeProtocol: slot0[5],
      unlocked: slot0[6],
    };
  }

  throw new Error(`Pool state is not verified for protocol: ${pool.protocol}`);
}
