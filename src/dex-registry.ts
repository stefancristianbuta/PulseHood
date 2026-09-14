import { CHAIN } from './config.js';

export type DexProtocol = 'uniswap-v2' | 'uniswap-v3' | 'uniswap-v4' | 'pons-v2' | 'ramses-v3' | 'sushiswap-v3' | 'pancakeswap-v2' | 'pancakeswap-v3' | 'robinswap-v3' | 'parityswap-v3' | 'sheriff-v3' | 'giga-v3' | 'unknown';

export interface DexDeployment {
  id: string;
  name: string;
  protocol: DexProtocol;
  chainId: number;
  factory?: `0x${string}`;
  poolManager?: `0x${string}`;
  stateView?: `0x${string}`;
  router?: `0x${string}`;
  quoter?: `0x${string}`;
  hook?: `0x${string}`;
  enabled: boolean;
  verifiedAt: string;
}

const VERIFIED_AT = '2026-09-14';

const INITIAL_DEPLOYMENTS: readonly DexDeployment[] = [
  { id: 'uniswap-v2-robinhood', name: 'Uniswap V2', protocol: 'uniswap-v2', chainId: CHAIN.id, factory: '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f', router: '0x89e5db8b5aa49aa85ac63f691524311aeb649eba', enabled: true, verifiedAt: VERIFIED_AT },
  { id: 'uniswap-v3-robinhood', name: 'Uniswap V3', protocol: 'uniswap-v3', chainId: CHAIN.id, factory: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa', router: '0xcaf681a66d020601342297493863e78c959e5cb2', quoter: '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7', enabled: true, verifiedAt: VERIFIED_AT },
  { id: 'uniswap-v4-robinhood', name: 'Uniswap V4', protocol: 'uniswap-v4', chainId: CHAIN.id, poolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951', stateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b', router: '0x8876789976decbfcbbbe364623c63652db8c0904', quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94', enabled: true, verifiedAt: VERIFIED_AT },
  { id: 'pons-v2-robinhood', name: 'Pons V2', protocol: 'pons-v2', chainId: CHAIN.id, factory: '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e', router: '0xe33e9e479df8802cb0866d5d05258bec4cf62948', hook: '0xe5e702641ea86f4ae6cc3cdaed2b886f976be044', enabled: true, verifiedAt: VERIFIED_AT },
  { id: 'ramses-v3-robinhood', name: 'Ramses V3', protocol: 'ramses-v3', chainId: CHAIN.id, factory: '0xe0c4ceb92d08ca985bb70fe0a22feb121a9854a8', router: '0xbfbb2bcbc9dffa029c27a249ae9be031e1d83b1c', quoter: '0x4730e03eb4a58a5e20244062d5f9a99bcf5770a6', enabled: true, verifiedAt: VERIFIED_AT },
  { id: 'sushiswap-v3-robinhood', name: 'SushiSwap V3', protocol: 'sushiswap-v3', chainId: CHAIN.id, factory: '0xe51960f1b45f1c9fb6d166e6a884f866fc70433b', router: '0x1e406484f1f204b23ce84b9901c0171a738fd406', enabled: true, verifiedAt: VERIFIED_AT },
  { id: 'pancakeswap-v2-robinhood', name: 'PancakeSwap V2', protocol: 'pancakeswap-v2', chainId: CHAIN.id, factory: '0x02a84c1b3bbd7401a5f7fa98a384ebc70bb5749e', router: '0x8cfe327cec66d1c090dd72bd0ff11d690c33a2eb', enabled: true, verifiedAt: VERIFIED_AT },
  { id: 'pancakeswap-v3-robinhood', name: 'PancakeSwap V3', protocol: 'pancakeswap-v3', chainId: CHAIN.id, factory: '0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865', router: '0xe28c0e44f4016b073db20cf28971ca6ce3664d3', enabled: true, verifiedAt: VERIFIED_AT },
  { id: 'robinswap-v3-robinhood', name: 'RobinSwap V3', protocol: 'robinswap-v3', chainId: CHAIN.id, factory: '0xea561e058313b96011e5070ca7d0f027a44e3748', enabled: true, verifiedAt: VERIFIED_AT },
  { id: 'parityswap-v3-robinhood', name: 'ParitySwap V3', protocol: 'parityswap-v3', chainId: CHAIN.id, factory: '0xd479e71c45aeb1e846a7b549c346d62fe77b39ba', enabled: true, verifiedAt: VERIFIED_AT },
  { id: 'sheriff-v3-robinhood', name: 'Sheriff V3', protocol: 'sheriff-v3', chainId: CHAIN.id, factory: '0x21fd9ab06cc927e66013e89b045c26b3ede7bb20', enabled: true, verifiedAt: VERIFIED_AT },
  { id: 'giga-v3-robinhood', name: 'Giga V3', protocol: 'giga-v3', chainId: CHAIN.id, factory: '0xece6ecd61177336ea6fb9b17937ac439d85ee20b', enabled: true, verifiedAt: VERIFIED_AT },
];

function normalize(address: `0x${string}`): `0x${string}` { return address.toLowerCase() as `0x${string}`; }

function normalizeDeployment(deployment: DexDeployment): DexDeployment {
  const normalized: DexDeployment = { id: deployment.id, name: deployment.name, protocol: deployment.protocol, chainId: deployment.chainId, enabled: deployment.enabled, verifiedAt: deployment.verifiedAt };
  if (deployment.factory !== undefined) normalized.factory = normalize(deployment.factory);
  if (deployment.poolManager !== undefined) normalized.poolManager = normalize(deployment.poolManager);
  if (deployment.stateView !== undefined) normalized.stateView = normalize(deployment.stateView);
  if (deployment.router !== undefined) normalized.router = normalize(deployment.router);
  if (deployment.quoter !== undefined) normalized.quoter = normalize(deployment.quoter);
  if (deployment.hook !== undefined) normalized.hook = normalize(deployment.hook);
  return normalized;
}

export class DexRegistry {
  private readonly deployments = new Map<string, DexDeployment>();
  constructor(initial: readonly DexDeployment[] = INITIAL_DEPLOYMENTS) { for (const deployment of initial) this.register(deployment); }
  register(deployment: DexDeployment): void {
    if (deployment.chainId !== CHAIN.id) throw new Error(`Unsupported DEX chain: ${deployment.chainId}`);
    if (!deployment.id.trim()) throw new Error('DEX deployment id is required');
    this.deployments.set(deployment.id, normalizeDeployment(deployment));
  }
  get(id: string): DexDeployment | undefined { const deployment = this.deployments.get(id); return deployment === undefined ? undefined : { ...deployment }; }
  listEnabled(): DexDeployment[] { return [...this.deployments.values()].filter((deployment) => deployment.enabled).map((deployment) => ({ ...deployment })); }
  all(): DexDeployment[] { return [...this.deployments.values()].map((deployment) => ({ ...deployment })); }
}

export const DEFAULT_DEX_REGISTRY = new DexRegistry();
