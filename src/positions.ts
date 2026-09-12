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

export class PositionManager {
  private readonly positions = new Map<string, Position>();
  private entriesEnabled = true;

  add(position: Position): void {
    if (this.positions.has(position.id)) throw new Error(`Position already exists: ${position.id}`);
    this.positions.set(position.id, { ...position });
  }

  get(id: string): Position | undefined {
    const position = this.positions.get(id);
    return position === undefined ? undefined : { ...position };
  }

  listOpen(): Position[] {
    return [...this.positions.values()]
      .filter((position) => position.state !== 'CLOSED')
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

    const decision = decideExit(position, market);
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
    return { ...position };
  }

  emergencyStopEntries(): void {
    this.entriesEnabled = false;
  }

  emergencyCloseAll(timestamp = Date.now()): Position[] {
    this.entriesEnabled = false;
    const closed: Position[] = [];
    for (const position of this.positions.values()) {
      if (position.state === 'CLOSED') continue;
      position.state = 'CLOSED';
      position.updatedAt = timestamp;
      closed.push({ ...position });
    }
    return closed;
  }
}
