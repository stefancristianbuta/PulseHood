import { decodeEventLog, parseAbi, type PublicClient } from 'viem';
import type { DexDeployment, DexProtocol } from './dex-registry.js';

export interface DiscoveredPool {
  dexId: string;
  protocol: DexProtocol;
  pool: `0x${string}`;
  token0: `0x${string}`;
  token1: `0x${string}`;
  fee?: number;
  tickSpacing?: number;
  blockNumber?: bigint;
  transactionHash?: `0x${string}`;
}

const V2_PAIR_CREATED = parseAbi([
  'event PairCreated(address indexed token0, address indexed token1, address pair, uint256 pairIndex)',
]);

const V3_POOL_CREATED = parseAbi([
  'event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)',
]);

const V4_INITIALIZE = parseAbi([
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)',
]);

export function supportedPoolDiscovery(protocol: DexProtocol): boolean {
  return protocol === 'uniswap-v2' || protocol === 'uniswap-v3' || protocol === 'uniswap-v4';
}

export function decodePoolCreationLog(
  deployment: DexDeployment,
  log: { topics: readonly `0x${string}`[]; data: `0x${string}`; blockNumber?: bigint; transactionHash?: `0x${string}` },
): DiscoveredPool {
  if (deployment.protocol === 'uniswap-v2') {
    const decoded = decodeEventLog({ abi: V2_PAIR_CREATED, topics: log.topics, data: log.data });
    const { token0, token1, pair } = decoded.args;
    return {
      dexId: deployment.id,
      protocol: deployment.protocol,
      pool,
      token0,
      token1,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
    };
  }

  if (deployment.protocol === 'uniswap-v3') {
    const decoded = decodeEventLog({ abi: V3_POOL_CREATED, topics: log.topics, data: log.data });
    const { token0, token1, fee, tickSpacing, pool } = decoded.args;
    return {
      dexId: deployment.id,
      protocol: deployment.protocol,
      pool,
      token0,
      token1,
      fee,
      tickSpacing,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
    };
  }

  if (deployment.protocol === 'uniswap-v4') {
    const decoded = decodeEventLog({ abi: V4_INITIALIZE, topics: log.topics, data: log.data });
    const { currency0, currency1, fee, tickSpacing } = decoded.args;
    return {
      dexId: deployment.id,
      protocol: deployment.protocol,
      pool: decoded.args.id as `0x${string}`,
      token0: currency0,
      token1: currency1,
      fee,
      tickSpacing,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
    };
  }

  throw new Error(`Pool discovery is not verified for protocol: ${deployment.protocol}`);
}

export async function discoverPools(
  client: PublicClient,
  deployment: DexDeployment,
  fromBlock: bigint,
  toBlock?: bigint,
): Promise<DiscoveredPool[]> {
  if (!supportedPoolDiscovery(deployment.protocol)) {
    throw new Error(`Pool discovery is not verified for protocol: ${deployment.protocol}`);
  }

  const address = deployment.protocol === 'uniswap-v4' ? deployment.poolManager : deployment.factory;
  if (!address) throw new Error(`Missing discovery contract for ${deployment.id}`);

  const event = deployment.protocol === 'uniswap-v2'
    ? V2_PAIR_CREATED[0]
    : deployment.protocol === 'uniswap-v3'
      ? V3_POOL_CREATED[0]
      : V4_INITIALIZE[0];

  const logs = await client.getLogs({
    address,
    event,
    fromBlock,
    ...(toBlock === undefined ? {} : { toBlock }),
  });

  return logs.map((log) => decodePoolCreationLog(deployment, {
    topics: log.topics,
    data: log.data,
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
  }));
}
