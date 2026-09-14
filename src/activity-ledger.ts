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
  reason?: string;
  entryCostUsd?: number;
  exitCostUsd?: number;
  grossPnlUsd?: number;
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

interface OpenRecord { positionId:string; opportunityId:string; token:string; entryPriceUsd:number; sizeUsd:number; openedAt:number; entryCostUsd:number; }

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
      this.open.set(id, { positionId:id, opportunityId:String(p.opportunityId ?? id), token:event.token ?? '', entryPriceUsd:Number(p.entryPriceUsd ?? 0), sizeUsd, openedAt:Date.now(), entryCostUsd:Number(p.entryCostUsd ?? 0) });
      this.availableUsd -= sizeUsd;
      return;
    }

    if (event.event === 'paper_position_closed' || event.event === 'paper_position_emergency_closed') {
      const id = String(p.positionId ?? '');
      const row = this.open.get(id);
      if (!row) return;
      const exitPriceUsd = Number(p.exitPriceUsd ?? row.entryPriceUsd);
      const netPnlUsd = event.event === 'paper_position_closed'
        ? Number(p.netPnlUsd ?? 0)
        : (row.entryPriceUsd > 0 ? row.sizeUsd * (exitPriceUsd / row.entryPriceUsd - 1) : 0);
      const netPnlPct = row.sizeUsd > 0 ? netPnlUsd / row.sizeUsd * 100 : 0;
      this.availableUsd += row.sizeUsd + netPnlUsd;
      this.realizedPnlUsd += netPnlUsd;
      this.closed.unshift({
        ...row,
        exitPriceUsd,
        pnlUsd: netPnlUsd,
        pnlPct: netPnlPct,
        closedAt:Number(p.closedAt ?? Date.now()),
        reason: String(p.reason ?? 'exit'),
        entryCostUsd: row.entryCostUsd,
        exitCostUsd:Number(p.exitCostUsd ?? 0),
        grossPnlUsd:Number(p.grossPnlUsd ?? netPnlUsd),
      });
      this.open.delete(id);
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
