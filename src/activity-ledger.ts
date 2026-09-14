import type { TelemetryEvent } from './telemetry.js';

export interface ClosedRecord {
  positionId: string;
  opportunityId: string;
  token: string;
  entryPriceUsd: number;
  exitPriceUsd: number;
  sizeUsd: number;
  pnlUsd: number;
  pnlPct: number;
  openedAt: number;
  closedAt: number;
}

export interface DashboardSummary {
  startingBalanceUsd: number;
  availableUsd: number;
  investedUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  totalLossUsd: number;
  totalTrades: number;
  wins: number;
  losses: number;
}

interface OpenRecord { positionId:string; opportunityId:string; token:string; entryPriceUsd:number; sizeUsd:number; openedAt:number; }

export class ActivityLedger {
  private readonly startingBalanceUsd = Math.max(100, Number(process.env.PAPER_STARTING_BALANCE_USD ?? 10000));
  private availableUsd = this.startingBalanceUsd;
  private realizedPnlUsd = 0;
  private readonly open = new Map<string, OpenRecord>();
  private readonly closed: ClosedRecord[] = [];

  onEvent(event: TelemetryEvent): void {
    const p = event.payload ?? {};
    if (event.event === 'paper_position_opened') {
      const id = String(p.positionId ?? '');
      if (!id) return;
      const sizeUsd = Number(p.sizeUsd ?? 0);
      this.open.set(id, { positionId:id, opportunityId:String(p.opportunityId ?? id), token:event.token ?? '', entryPriceUsd:Number(p.entryPriceUsd ?? 0), sizeUsd, openedAt:Date.now() });
      this.availableUsd -= sizeUsd;
      return;
    }
    if (event.event === 'paper_fill' && p.side === 'SELL') {
      const token = String(event.token ?? '').toLowerCase();
      const row = [...this.open.values()].find(x => x.token.toLowerCase() === token);
      if (!row) return;
      const exitPriceUsd = Number(p.executionPriceUsd ?? 0);
      const exitValueUsd = row.entryPriceUsd > 0 ? row.sizeUsd * exitPriceUsd / row.entryPriceUsd : row.sizeUsd;
      const pnlUsd = exitValueUsd - row.sizeUsd;
      const pnlPct = row.sizeUsd > 0 ? pnlUsd / row.sizeUsd * 100 : 0;
      this.availableUsd += exitValueUsd;
      this.realizedPnlUsd += pnlUsd;
      this.closed.unshift({ ...row, exitPriceUsd, pnlUsd, pnlPct, closedAt:Date.now() });
      this.open.delete(row.positionId);
      if (this.closed.length > 200) this.closed.length = 200;
    }
  }

  summary(positions:Array<{sizeUsd:number;entryPriceUsd:number;currentPriceUsd:number}>): DashboardSummary {
    const investedUsd = positions.reduce((sum,p)=>sum+Number(p.sizeUsd||0),0);
    const unrealizedPnlUsd = positions.reduce((sum,p)=>sum+(p.entryPriceUsd>0?p.sizeUsd*(p.currentPriceUsd/p.entryPriceUsd-1):0),0);
    return { startingBalanceUsd:this.startingBalanceUsd, availableUsd:this.availableUsd, investedUsd, realizedPnlUsd:this.realizedPnlUsd, unrealizedPnlUsd, totalPnlUsd:this.realizedPnlUsd+unrealizedPnlUsd, totalLossUsd:Math.max(0,-this.realizedPnlUsd)+Math.max(0,-unrealizedPnlUsd), totalTrades:this.closed.length, wins:this.closed.filter(x=>x.pnlUsd>0).length, losses:this.closed.filter(x=>x.pnlUsd<0).length };
  }

  history(): ClosedRecord[] { return this.closed.slice(); }
}
