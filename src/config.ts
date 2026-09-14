import { defineChain } from 'viem';
import type { TradingMode } from './domain.js';

export const CHAIN = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://rpc.mainnet.chain.robinhood.com'],
      webSocket: ['wss://feed.mainnet.chain.robinhood.com'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Robinhood Blockscout',
      url: 'https://robinhoodchain.blockscout.com',
    },
  },
});

export const CHAIN_RPC_PUBLIC = 'https://rpc.mainnet.chain.robinhood.com';
export const CHAIN_SEQUENCER_FEED_PUBLIC = 'wss://feed.mainnet.chain.robinhood.com';

// Public fallbacks are intentionally used only as a bootstrap path. Robinhood documents
// its public RPC as rate-limited and recommends a dedicated provider for production.
// These two additional keyless endpoints reduce single-endpoint failure during development.
const DEFAULT_RPC_URLS = [
  CHAIN_RPC_PUBLIC,
  'https://rpc-robinhood.blockmachine.io',
  'https://robinhood-mainnet-rpc.blockreq.com/v1/rpc/public',
];

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
    rpcUrls: rpcUrls.length > 0 ? rpcUrls : DEFAULT_RPC_URLS,
    wsUrls: wsUrls.length > 0 ? wsUrls : [CHAIN_SEQUENCER_FEED_PUBLIC],
    maxRpcLatencyMs: Number(env.MAX_RPC_LATENCY_MS ?? 750),
    maxBlockLag: Number(env.MAX_BLOCK_LAG ?? 3),
    paperCapitalUsd: Number(env.PAPER_CAPITAL_USD ?? 10_000),
  };
}
