export type TradingMode = 'paper' | 'live';
export type Signal = 'BUY' | 'WATCH' | 'REJECT';
export type PositionState = 'DISCOVERED' | 'QUALIFIED' | 'SIGNAL' | 'ENTRY' | 'OPEN' | 'TRAILING' | 'EXIT_SIGNAL' | 'CLOSED';

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
