import { getAddress, isAddress } from 'viem';
import { CHAIN } from './config.js';
import type { RpcManager } from './rpc.js';
import { TelemetryBus } from './telemetry.js';

const ERC20_ABI = [
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
] as const;

export interface ScanResult {
  validAddress: boolean;
  isContract: boolean;
  chainId: number;
  address?: `0x${string}`;
  symbol?: string;
  decimals?: number;
  error?: string;
}

export async function scanContract(
  rawAddress: string,
  rpc: RpcManager,
  telemetry: TelemetryBus,
): Promise<ScanResult> {
  const correlationId = TelemetryBus.correlationId('SCAN');
  if (!isAddress(rawAddress)) {
    return { validAddress: false, isContract: false, chainId: CHAIN.id, error: 'Invalid EVM address' };
  }

  const address = getAddress(rawAddress) as `0x${string}`;
  const started = performance.now();

  try {
    const client = rpc.getClient();
    const chainId = await client.getChainId();
    if (chainId !== CHAIN.id) {
      throw new Error(`Wrong chain: expected ${CHAIN.id}, received ${chainId}`);
    }

    const code = await client.getCode({ address });
    const isContract = Boolean(code && code !== '0x');
    if (!isContract) {
      return { validAddress: true, isContract: false, chainId, address, error: 'Address has no contract code' };
    }

    const [symbol, decimals] = await Promise.all([
      client.readContract({ address, abi: ERC20_ABI, functionName: 'symbol' }),
      client.readContract({ address, abi: ERC20_ABI, functionName: 'decimals' }),
    ]);

    telemetry.emitEvent({
      correlationId,
      module: 'scan',
      event: 'contract_validated',
      token: address,
      latencyMs: performance.now() - started,
      status: 'ok',
      payload: { chainId, symbol, decimals },
    });

    return { validAddress: true, isContract: true, chainId, address, symbol, decimals };
  } catch (error) {
    telemetry.emitEvent({
      correlationId,
      module: 'scan',
      event: 'contract_scan_failed',
      token: address,
      latencyMs: performance.now() - started,
      status: 'error',
      payload: { error: error instanceof Error ? error.message : String(error) },
    });
    return {
      validAddress: true,
      isContract: false,
      chainId: CHAIN.id,
      address,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
