import type { NormalizedSwap } from './swap-event.js';

export interface FlowInput {
  swap: NormalizedSwap;
  trader: `0x${string}`;
  volumeUsd: number;
  priceUsd: number;
  timestampMs: number;
}

export interface FlowSnapshot {
  token: `0x${string}`;
  windowStartMs: number;
  buyVolumeUsd: number;
  sellVolumeUsd: number;
  volumeUsd: number;
  buyPressurePct: number;
  buyCount: number;
  sellCount: number;
  uniqueBuyers: number;
  uniqueSellers: number;
  uniqueBuyerDeltaPct: number;
  volumeAccelerationPct: number;
  priceUsd: number;
  previousPriceUsd: number | undefined;
  priceChangePct: number;
}

interface WindowState {
  startMs: number;
  buyVolumeUsd: number;
  sellVolumeUsd: number;
  buyCount: number;
  sellCount: number;
  buyers: Set<string>;
  sellers: Set<string>;
  firstPriceUsd: number | undefined;
  lastPriceUsd: number | undefined;
  previousVolumeUsd: number | undefined;
  previousUniqueBuyers: number | undefined;
}

function windowStart(timestampMs: number, windowMs: number): number { return Math.floor(timestampMs / windowMs) * windowMs; }
function pctChange(current: number, previous: number | undefined): number {
  if (previous === undefined) return 0;
  if (previous <= 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

export class FlowEngine {
  private readonly windows = new Map<string, WindowState>();
  constructor(private readonly windowMs = 60_000) { if (!Number.isInteger(windowMs) || windowMs <= 0) throw new Error('windowMs must be a positive integer'); }
  process(input: FlowInput): FlowSnapshot | undefined {
    if (!Number.isFinite(input.volumeUsd) || input.volumeUsd < 0) return undefined;
    if (!Number.isFinite(input.priceUsd) || input.priceUsd <= 0) return undefined;
    if (input.swap.status !== 'normalized') return undefined;
    if (input.swap.direction === 'UNKNOWN') return undefined;
    const token = input.swap.targetToken;
    const startMs = windowStart(input.timestampMs, this.windowMs);
    const key = token.toLowerCase();
    let state = this.windows.get(key);
    if (state === undefined || state.startMs !== startMs) {
      state = { startMs, buyVolumeUsd: 0, sellVolumeUsd: 0, buyCount: 0, sellCount: 0, buyers: new Set(), sellers: new Set(), firstPriceUsd: input.priceUsd, lastPriceUsd: undefined, previousVolumeUsd: state?.buyVolumeUsd !== undefined ? state.buyVolumeUsd + state.sellVolumeUsd : undefined, previousUniqueBuyers: state?.buyers.size };
      this.windows.set(key, state);
    }
    const previousPriceUsd = state.lastPriceUsd;
    state.firstPriceUsd ??= input.priceUsd;
    state.lastPriceUsd = input.priceUsd;
    if (input.swap.direction === 'BUY') {
      state.buyVolumeUsd += input.volumeUsd;
      state.buyCount += 1;
      state.buyers.add(input.trader.toLowerCase());
    } else {
      state.sellVolumeUsd += input.volumeUsd;
      state.sellCount += 1;
      state.sellers.add(input.trader.toLowerCase());
    }
    const volumeUsd = state.buyVolumeUsd + state.sellVolumeUsd;
    const buyPressurePct = volumeUsd > 0 ? (state.buyVolumeUsd / volumeUsd) * 100 : 0;
    const uniqueBuyerDeltaPct = pctChange(state.buyers.size, state.previousUniqueBuyers);
    const volumeAccelerationPct = pctChange(volumeUsd, state.previousVolumeUsd);
    const priceChangePct = pctChange(input.priceUsd, state.firstPriceUsd);
    return { token, windowStartMs: state.startMs, buyVolumeUsd: state.buyVolumeUsd, sellVolumeUsd: state.sellVolumeUsd, volumeUsd, buyPressurePct, buyCount: state.buyCount, sellCount: state.sellCount, uniqueBuyers: state.buyers.size, uniqueSellers: state.sellers.size, uniqueBuyerDeltaPct, volumeAccelerationPct, priceUsd: input.priceUsd, previousPriceUsd, priceChangePct };
  }
  clear(token?: `0x${string}`): void { if (token === undefined) this.windows.clear(); else this.windows.delete(token.toLowerCase()); }
}
