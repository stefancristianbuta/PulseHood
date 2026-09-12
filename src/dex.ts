export interface DexVenue {
  id: string;
  name: string;
  family: 'uniswap-v2' | 'uniswap-v3' | 'uniswap-v4' | 'clmm' | 'amm' | 'aggregator';
  enabled: boolean;
  volume24hUsd: number;
  liquidityUsd: number;
  executionLatencyMs: number;
  priceImpactBps: number;
  recentActivityScore: number;
}

export interface ScoredDex extends DexVenue {
  score: number;
}

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const normalizeInverse = (value: number, max: number) => clamp(100 - (value / max) * 100);

export function scoreDex(venue: DexVenue, maxVolumeUsd: number, maxLiquidityUsd: number): number {
  const volumeScore = maxVolumeUsd > 0 ? (venue.volume24hUsd / maxVolumeUsd) * 100 : 0;
  const liquidityScore = maxLiquidityUsd > 0 ? (venue.liquidityUsd / maxLiquidityUsd) * 100 : 0;
  const latencyScore = normalizeInverse(venue.executionLatencyMs, 2_000);
  const impactScore = normalizeInverse(venue.priceImpactBps, 500);
  return clamp(
    volumeScore * 0.35 +
    liquidityScore * 0.25 +
    latencyScore * 0.20 +
    impactScore * 0.10 +
    venue.recentActivityScore * 0.10,
  );
}

export class DexScoringRegistry {
  private venues = new Map<string, DexVenue>();

  upsert(venue: DexVenue): void {
    this.venues.set(venue.id, venue);
  }

  remove(id: string): void {
    this.venues.delete(id);
  }

  ranked(): ScoredDex[] {
    const enabled = [...this.venues.values()].filter((venue) => venue.enabled);
    const maxVolume = Math.max(0, ...enabled.map((venue) => venue.volume24hUsd));
    const maxLiquidity = Math.max(0, ...enabled.map((venue) => venue.liquidityUsd));
    return enabled
      .map((venue) => ({ ...venue, score: scoreDex(venue, maxVolume, maxLiquidity) }))
      .sort((a, b) => b.score - a.score);
  }

  get(id: string): DexVenue | undefined {
    return this.venues.get(id);
  }
}

// Only deployments with verified Robinhood Chain addresses are included by default.
export const INITIAL_DEX_IDS = [
  'uniswap-v3',
  'uniswap-v4',
  'pons-v2',
  'ramses-v3',
] as const;
