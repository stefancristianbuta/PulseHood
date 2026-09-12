export type TradingMode = 'paper' | 'live';
export type Signal = 'BUY' | 'WATCH' | 'REJECT';
export type PositionState =
  | 'DISCOVERED'
  | 'QUALIFIED'
  | 'SIGNAL'
  | 'ENTRY'
  | 'OPEN'
  | 'TRAILING'
  | 'EXIT_SIGNAL'
  | 'CLOSED';

export interface MomentumInput {
  priceAcceleration: number;
  volumeAcceleration: number;
  buyPressure: number;
  uniqueBuyerScore: number;
  liquidityScore: number;
  breakoutScore: number;
}

export interface MomentumResult {
  score: number;
  signal: Signal;
}

export interface RiskResult {
  score: number;
  tradable: boolean;
}

export interface TokenSnapshot {
  chainId: number;
  address: `0x${string}`;
  symbol: string;
  priceUsd: number;
  liquidityUsd: number;
  volume1mUsd: number;
  buyPressurePct: number;
  uniqueBuyersDeltaPct: number;
}

export interface PaperCost {
  dexFeeUsd: number;
  gasUsd: number;
  slippageUsd: number;
  priceImpactUsd: number;
  totalUsd: number;
}

export interface PaperFill {
  side: 'BUY' | 'SELL';
  requestedUsd: number;
  executedUsd: number;
  executionPriceUsd: number;
  cost: PaperCost;
  timestamp: number;
}

export interface ExecutionQuote {
  dexId: string;
  token: `0x${string}`;
  amountInUsd: number;
  expectedAmountOutUsd: number;
  executablePriceUsd: number;
  dexFeeUsd: number;
  priceImpactUsd: number;
  gasEstimate: bigint;
  gasPriceWei: bigint;
  nativeTokenUsd: number;
  quotedAt: number;
  latencyMs: number;
}

export interface ExecutionResult {
  fill: PaperFill;
  quote: ExecutionQuote;
  txHash?: `0x${string}`;
}

export interface Position {
  id: string;
  opportunityId: string;
  token: `0x${string}`;
  symbol: string;
  state: PositionState;
  entryPriceUsd: number;
  currentPriceUsd: number;
  peakPriceUsd: number;
  sizeUsd: number;
  momentumAtEntry: number;
  momentumPeak: number;
  openedAt: number;
  updatedAt: number;
}

export interface MarketUpdate {
  priceUsd: number;
  momentum: number;
  volumeAcceleration: number;
  timestamp: number;
}

export interface ExitDecision {
  action: 'HOLD' | 'TIGHTEN' | 'SELL';
  reason: string;
  trailingDistancePct: number;
}
