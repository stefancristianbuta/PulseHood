import { CHAIN } from './config.js';

export type DexProtocol = 'uniswap-v2' | 'uniswap-v3' | 'uniswap-v4' | 'pons-v2' | 'ramses-v3' | 'unknown';

export interface DexDeployment {
  id: string;
  name: string;
  protocol: DexProtocol;
  chainId: number;
  factory?: `0x${string}`;
  poolManager?: `0x${string}`;
  router?: `0x${string}`;
  quoter?: `0x${string}`;
  hook?: `0x${string}`;
  enabled: boolean;
  verifiedAt: string;
}

const VERIFIED_AT = '2026-09-12';

const INITIAL_DEPLOYMENTS: readonly DexDeployment[] = [
  {
    id: 'uniswap-v3-robinhood',
    name: 'Uniswap V3',
    protocol: 'uniswap-v3',
    chainId: CHAIN.id,
    factory: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa',
    router: '0xcaf681a66d020601342297493863e78c959e5cb2',
    quoter: '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7',
    enabled: true,
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'uniswap-v4-robinhood',
    name: 'Uniswap V4',
    protocol: 'uniswap-v4',
    chainId: CHAIN.id,
    poolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
    router: '0x8876789976decbfcbbbe364623c63652db8c0904',
    quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
    enabled: true,
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'pons-v2-robinhood',
    name: 'Pons V2',
    protocol: 'pons-v2',
    chainId: CHAIN.id,
    factory: '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e',
    router: '0xe33e9e479df8802cb0866d5d05258bec4cf62948',
    hook: '0xe5e702641ea86f4ae6cc3cdaed2b886f976be044',
    enabled: true,
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'ramses-v3-robinhood',
    name: 'Ramses V3',
    protocol: 'ramses-v3',
    chainId: CHAIN.id,
    factory: '0xe0c4ceb92d08ca985bb70fe0a22feb121a9854a8',
    router: '0xbfbb2bcbc9dffa029c27a249ae9be031e1d83b1c',
    quoter: '0x4730e03eb4a58a5e20244062d5f9a99bcf5770a6',
    enabled: true,
    verifiedAt: VERIFIED_AT,
  },
];

function normalize(address: `0x${string}`): `0x${string}` {
  return address.toLowerCase() as `0x${string}`;
}

function normalizeDeployment(deployment: DexDeployment): DexDeployment {
  const normalized: DexDeployment = {
    id: deployment.id,
    name: deployment.name,
    protocol: deployment.protocol,
    chainId: deployment.chainId,
    enabled: deployment.enabled,
    verifiedAt: deployment.verifiedAt,
  };

  if (deployment.factory !== undefined) normalized.factory = normalize(deployment.factory);
  if (deployment.poolManager !== undefined) normalized.poolManager = normalize(deployment.poolManager);
  if (deployment.router !== undefined) normalized.router = normalize(deployment.router);
  if (deployment.quoter !== undefined) normalized.quoter = normalize(deployment.quoter);
  if (deployment.hook !== undefined) normalized.hook = normalize(deployment.hook);

  return normalized;
}

export class DexRegistry {
  private readonly deployments = new Map<string, DexDeployment>();

  constructor(initial: readonly DexDeployment[] = INITIAL_DEPLOYMENTS) {
    for (const deployment of initial) this.register(deployment);
  }

  register(deployment: DexDeployment): void {
    if (deployment.chainId !== CHAIN.id) throw new Error(`Unsupported DEX chain: ${deployment.chainId}`);
    if (!deployment.id.trim()) throw new Error('DEX deployment id is required');
    this.deployments.set(deployment.id, normalizeDeployment(deployment));
  }

  get(id: string): DexDeployment | undefined {
    const deployment = this.deployments.get(id);
    return deployment === undefined ? undefined : { ...deployment };
  }

  listEnabled(): DexDeployment[] {
    return [...this.deployments.values()]
      .filter((deployment) => deployment.enabled)
      .map((deployment) => ({ ...deployment }));
  }

  all(): DexDeployment[] {
    return [...this.deployments.values()].map((deployment) => ({ ...deployment }));
  }
}

export const DEFAULT_DEX_REGISTRY = new DexRegistry();
