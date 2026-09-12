import type { TradingMode } from './domain.js';

export const CHAIN = {
  id: 4663,
  name: 'Robinhood Chain',
  nativeSymbol: 'ETH',
  rpcPublic: 'https://rpc.mainnet.chain.robinhood.com',
  sequencerFeedPublic: 'wss://feed.mainnet.chain.robinhood.com',
} as const;

const splitUrls = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export interface RuntimeConfig {
  chainId: number;
  tradingMode: TradingMode;
  liveEnabled: boolean;
  rpcUrls: string[];
  wsUrls: string[];
  maxRpcLatencyMs: number;
  maxBlockLag: number;
  paperCapitalUsd: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const tradingMode = env.TRADING_MODE === 'live' ? 'live' : 'paper';
  const liveEnabled = env.LIVE_ENABLED === 'true';

  if (tradingMode === 'live' && !liveEnabled) {
    throw new Error('TRADING_MODE=live requires LIVE_ENABLED=true');
  }

  const rpcUrls = splitUrls(env.RPC_URLS);
  const wsUrls = splitUrls(env.WS_URLS);

  return {
    chainId: CHAIN.id,
    tradingMode,
    liveEnabled,
    rpcUrls: rpcUrls.length > 0 ? rpcUrls : [CHAIN.rpcPublic],
    wsUrls: wsUrls.length > 0 ? wsUrls : [CHAIN.sequencerFeedPublic],
    maxRpcLatencyMs: Number(env.MAX_RPC_LATENCY_MS ?? 750),
    maxBlockLag: Number(env.MAX_BLOCK_LAG ?? 3),
    paperCapitalUsd: Number(env.PAPER_CAPITAL_USD ?? 10_000),
  };
}
