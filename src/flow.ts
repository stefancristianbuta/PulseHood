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
  microPriceChangePct: number;
  largestBuyerVolumePct: number;
}

interface PriceSample { timestampMs: number; priceUsd: number; }
interface WindowState {
  startMs: number;
  buyVolumeUsd: number;
  sellVolumeUsd: number;
  buyCount: number;
  sellCount: number;
  buyers: Set<string>;
  sellers: Set<string>;
  buyerVolumes: Map<string, number>;
  firstPriceUsd: number | undefined;
  lastPriceUsd: number | undefined;
  previousVolumeUsd: number | undefined;
  previousUniqueBuyers: number | undefined;
  priceSamples: PriceSample[];
}
function windowStart(timestampMs: number, windowMs: number): number { return Math.floor(timestampMs / windowMs) * windowMs; }
function pctChange(current: number, previous: number | undefined): number { if (previous === undefined) return 0; if (previous <= 0) return current > 0 ? 100 : 0; return ((current - previous) / previous) * 100; }
export class FlowEngine {
  private readonly windows = new Map<string, WindowState>();
  constructor(private readonly windowMs = 60_000) { if (!Number.isInteger(windowMs) || windowMs <= 0) throw new Error('windowMs must be a positive integer'); }
  process(input: FlowInput): FlowSnapshot | undefined {
    if (!Number.isFinite(input.volumeUsd) || input.volumeUsd < 0) return undefined;
    if (!Number.isFinite(input.priceUsd) || input.priceUsd <= 0) return undefined;
    if (input.swap.status !== 'normalized' || input.swap.direction === 'UNKNOWN') return undefined;
    const token = input.swap.targetToken;
    const startMs = windowStart(input.timestampMs, this.windowMs);
    const key = token.toLowerCase();
    let state = this.windows.get(key);
    if (state === undefined || state.startMs !== startMs) {
      state = { startMs, buyVolumeUsd: 0, sellVolumeUsd: 0, buyCount: 0, sellCount: 0, buyers: new Set(), sellers: new Set(), buyerVolumes: new Map(), firstPriceUsd: input.priceUsd, lastPriceUsd: undefined, previousVolumeUsd: state?.buyVolumeUsd !== undefined ? state.buyVolumeUsd + state.sellVolumeUsd : undefined, previousUniqueBuyers: state?.buyers.size, priceSamples: [] };
      this.windows.set(key, state);
    }
    const previousPriceUsd = state.lastPriceUsd;
    state.firstPriceUsd ??= input.priceUsd;
    state.lastPriceUsd = input.priceUsd;
    state.priceSamples.push({ timestampMs: input.timestampMs, priceUsd: input.priceUsd });
    const cutoff = input.timestampMs - 15_000;
    while (state.priceSamples.length > 1 && state.priceSamples[0].timestampMs < cutoff) state.priceSamples.shift();
    if (input.swap.direction === 'BUY') {
      state.buyVolumeUsd += input.volumeUsd;
      state.buyCount += 1;
      const trader = input.trader.toLowerCase();
      state.buyers.add(trader);
      state.buyerVolumes.set(trader, (state.buyerVolumes.get(trader) ?? 0) + input.volumeUsd);
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
    const microPriceChangePct = pctChange(input.priceUsd, state.priceSamples[0]?.priceUsd ?? input.priceUsd);
    const largestBuyerVolumeUsd = Math.max(0, ...state.buyerVolumes.values());
    const largestBuyerVolumePct = state.buyVolumeUsd > 0 ? (largestBuyerVolumeUsd / state.buyVolumeUsd) * 100 : 100;
    return { token, windowStartMs: state.startMs, buyVolumeUsd: state.buyVolumeUsd, sellVolumeUsd: state.sellVolumeUsd, volumeUsd, buyPressurePct, buyCount: state.buyCount, sellCount: state.sellCount, uniqueBuyers: state.buyers.size, uniqueSellers: state.sellers.size, uniqueBuyerDeltaPct, volumeAccelerationPct, priceUsd: input.priceUsd, previousPriceUsd, priceChangePct, microPriceChangePct, largestBuyerVolumePct };
  }
  clear(token?: `0x${string}`): void { if (token === undefined) this.windows.clear(); else this.windows.delete(token.toLowerCase()); }
}
