import type { ExitDecision, MarketUpdate, Position, PositionState } from './domain.js';
import { decideExit } from './strategy.js';

const ALLOWED: Record<PositionState, readonly PositionState[]> = {
  DISCOVERED: ['QUALIFIED', 'CLOSED'],
  QUALIFIED: ['SIGNAL', 'CLOSED'],
  SIGNAL: ['ENTRY', 'CLOSED'],
  ENTRY: ['OPEN', 'CLOSED'],
  OPEN: ['TRAILING', 'EXIT_SIGNAL', 'CLOSED'],
  TRAILING: ['TRAILING', 'EXIT_SIGNAL', 'CLOSED'],
  EXIT_SIGNAL: ['CLOSED', 'TRAILING'],
  CLOSED: [],
};

const ACTIVE_STATES = new Set<PositionState>(['ENTRY', 'OPEN', 'TRAILING', 'EXIT_SIGNAL']);
const MOMENTUM_EXIT_CONFIRMATIONS = Math.max(2, Number(process.env.PAPER_EXIT_CONFIRMATIONS ?? 3));

export class PositionManager {
  private readonly positions = new Map<string, Position>();
  private readonly momentumExitConfirmations = new Map<string, number>();
  private entriesEnabled = true;

  add(position: Position): void {
    if (this.positions.has(position.id)) throw new Error(`Position already exists: ${position.id}`);
    this.positions.set(position.id, { ...position });
    this.momentumExitConfirmations.delete(position.id);
  }

  get(id: string): Position | undefined {
    const position = this.positions.get(id);
    return position === undefined ? undefined : { ...position };
  }

  listOpen(): Position[] {
    return [...this.positions.values()]
      .filter((position) => ACTIVE_STATES.has(position.state))
      .map((position) => ({ ...position }));
  }

  setEntriesEnabled(enabled: boolean): void {
    this.entriesEnabled = enabled;
  }

  canEnter(): boolean {
    return this.entriesEnabled;
  }

  transition(id: string, next: PositionState): Position {
    const position = this.positions.get(id);
    if (position === undefined) throw new Error(`Unknown position: ${id}`);
    if (!ALLOWED[position.state].includes(next)) {
      throw new Error(`Invalid position transition ${position.state} -> ${next}`);
    }
    position.state = next;
    position.updatedAt = Date.now();
    return { ...position };
  }

  updateMarket(id: string, market: MarketUpdate): { position: Position; decision: ExitDecision } {
    const position = this.positions.get(id);
    if (position === undefined) throw new Error(`Unknown position: ${id}`);
    if (position.state === 'CLOSED') throw new Error(`Position is closed: ${id}`);

    position.currentPriceUsd = market.priceUsd;
    position.peakPriceUsd = Math.max(position.peakPriceUsd, market.priceUsd);
    position.momentumPeak = Math.max(position.momentumPeak, market.momentum);
    position.updatedAt = market.timestamp;

    let decision = decideExit(position, market);
    const isMomentumExit = decision.action === 'SELL' && decision.reason.startsWith('momentum deterioration');
    if (isMomentumExit) {
      const confirmations = (this.momentumExitConfirmations.get(id) ?? 0) + 1;
      this.momentumExitConfirmations.set(id, confirmations);
      if (confirmations < MOMENTUM_EXIT_CONFIRMATIONS) {
        decision = {
          action: 'TIGHTEN',
          reason: `momentum deterioration confirmation ${confirmations}/${MOMENTUM_EXIT_CONFIRMATIONS}`,
          trailingDistancePct: decision.trailingDistancePct,
        };
      }
    } else if (decision.action !== 'SELL' || !decision.reason.startsWith('momentum deterioration')) {
      this.momentumExitConfirmations.delete(id);
    }

    if (decision.action === 'SELL') {
      position.state = 'EXIT_SIGNAL';
    } else if (decision.action === 'TIGHTEN' || position.state === 'TRAILING') {
      position.state = 'TRAILING';
    }

    return { position: { ...position }, decision };
  }

  close(id: string, timestamp = Date.now()): Position {
    const position = this.positions.get(id);
    if (position === undefined) throw new Error(`Unknown position: ${id}`);
    position.state = 'CLOSED';
    position.updatedAt = timestamp;
    this.momentumExitConfirmations.delete(id);
    return { ...position };
  }

  emergencyStopEntries(): void {
    this.entriesEnabled = false;
  }

  emergencyCloseAll(timestamp = Date.now()): Position[] {
    this.entriesEnabled = false;
    const closed: Position[] = [];
    for (const position of this.positions.values()) {
      if (!ACTIVE_STATES.has(position.state)) continue;
      position.state = 'CLOSED';
      position.updatedAt = timestamp;
      this.momentumExitConfirmations.delete(position.id);
      closed.push({ ...position });
    }
    return closed;
  }
}
