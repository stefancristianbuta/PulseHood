import type { PublicClient, Transport } from 'viem';
import { parseAbi } from 'viem';
import { FlowEngine, type FlowSnapshot } from './flow.js';
import { PaperExecutionEngine } from './execution.js';
import type { ExecutionQuote, Position } from './domain.js';
import { PositionManager } from './positions.js';
import { evaluateSignal } from './signal.js';
import { RadarIngest } from './radar-ingest.js';
import { TelemetryBus } from './telemetry.js';
import { chooseBestQuote } from './quote.js';

const ERC20 = parseAbi(['function decimals() view returns (uint8)']);
const V2 = parseAbi(['function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)', 'function token0() view returns (address)', 'function token1() view returns (address)']);
const V3 = parseAbi(['function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)', 'function liquidity() view returns (uint128)', 'function token0() view returns (address)', 'function token1() view returns (address)']);
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'.toLowerCase();
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'.toLowerCase();
const PAPER_ETH_USD = Number(process.env.PAPER_ETH_USD ?? 3000);
const ENTRY_SIZE_USD = Number(process.env.PAPER_ENTRY_SIZE_USD ?? 250);
const MIN_LIQUIDITY_USD = Number(process.env.MIN_LIQUIDITY_USD ?? 25_000);
const MIN_UNIQUE_BUYER_SCORE = Number(process.env.MIN_UNIQUE_BUYER_SCORE ?? 20);
const PAPER_DEX_FEE_PCT = Math.max(0, Number(process.env.PAPER_DEX_FEE_PCT ?? 0.3));
const PAPER_SLIPPAGE_PCT = Math.max(0, Number(process.env.PAPER_SLIPPAGE_PCT ?? 0.5));
const PAPER_GAS_LIMIT = BigInt(Math.max(21_000, Math.floor(Number(process.env.PAPER_GAS_LIMIT ?? 120_000))));
const PAPER_GAS_PRICE_GWEI = BigInt(Math.max(1, Math.floor(Number(process.env.PAPER_GAS_PRICE_GWEI ?? 1))) * 1_000_000_000);
const V2_PROTOCOL = 'uniswap-v2';
const TICK_INTERVAL_MS = 2_000;
const POSITION_MARK_INTERVAL_MS = 1_000;
const SWAP_WORKER_CONCURRENCY = 1;
const SWAP_TIMEOUT_MS = 8_000;
const MARKET_CACHE_TTL_MS = 750;
type Client = PublicClient<Transport>;
type Addr = `0x${string}`;
interface PoolMarket { liquidityUsd: number; priceUsd: number; quotePriceUsd: number; }
interface PositionMarket { protocol: string; pool: Addr; quote: Addr; }
function finite(value: number, fallback = 0): number { return Number.isFinite(value) ? value : fallback; }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function opportunityId(sequence: number): string { const d = new Date(); const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`; return `OPP-${stamp}-${String(sequence).padStart(6, '0')}`; }

export class PaperTradingRuntime {
  private readonly flow = new FlowEngine(60_000);
  private readonly positions = new PositionManager();
  private readonly execution: PaperExecutionEngine;
  private readonly seen = new Set<string>();
  private readonly positionMarkets = new Map<string, PositionMarket>();
  private readonly latestFlows = new Map<string, FlowSnapshot>();
  private readonly marketCache = new Map<string, { market: PoolMarket; expiresAt: number }>();
  private readonly marketInFlight = new Map<string, Promise<PoolMarket | undefined>>();
  private sequence = 0;
  private running = false;
  private ticking = false;
  private timer: NodeJS.Timeout | undefined;
  private markTimer: NodeJS.Timeout | undefined;
  private marking = false;
  private lastBlock = 0n;
  private readonly minLiquidityUsd: number;
  private readonly entrySizeUsd: number;

  constructor(private readonly client: Client, private readonly telemetry: TelemetryBus, private readonly ingest: RadarIngest) {
    this.execution = new PaperExecutionEngine(telemetry);
    this.minLiquidityUsd = Math.max(1, MIN_LIQUIDITY_USD);
    this.entrySizeUsd = Math.max(25, ENTRY_SIZE_USD);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick();
    void this.markToMarketSafely();
    this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    this.timer.unref();
    this.markTimer = setInterval(() => void this.markToMarketSafely(), POSITION_MARK_INTERVAL_MS);
    this.markTimer.unref();
    console.log(JSON.stringify({ event: 'paper_strategy_started', entrySizeUsd: this.entrySizeUsd, minLiquidityUsd: this.minLiquidityUsd, positionMonitorIntervalMs: POSITION_MARK_INTERVAL_MS, tickIntervalMs: TICK_INTERVAL_MS, tickOverlapGuard: true, swapWorkerConcurrency: SWAP_WORKER_CONCURRENCY, swapTimeoutMs: SWAP_TIMEOUT_MS, marketCacheTtlMs: MARKET_CACHE_TTL_MS, exitConfirmations: Math.max(2, Number(process.env.PAPER_EXIT_CONFIRMATIONS ?? 3)), execution: { dexFeePct: PAPER_DEX_FEE_PCT, slippagePct: PAPER_SLIPPAGE_PCT, gasLimit: PAPER_GAS_LIMIT.toString(), gasPriceWei: PAPER_GAS_PRICE_GWEI.toString() } }));
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    if (this.markTimer !== undefined) clearInterval(this.markTimer);
    this.timer = undefined;
    this.markTimer = undefined;
    this.running = false;
  }

  listOpen(): Position[] { return this.positions.listOpen(); }
  stopEntries(): void { this.positions.emergencyStopEntries(); }
  closeAll(): Position[] {
    const timestamp = Date.now();
    const closed = this.positions.emergencyCloseAll(timestamp);
    for (const position of closed) {
      this.positionMarkets.delete(position.id);
      this.telemetry.emitEvent({ correlationId: TelemetryBus.correlationId('EMERGENCY'), module: 'positions', event: 'paper_position_emergency_closed', token: position.token, status: 'warning', payload: { positionId: position.id, opportunityId: position.opportunityId, entryPriceUsd: position.entryPriceUsd, exitPriceUsd: position.currentPriceUsd, sizeUsd: position.sizeUsd, reason: 'manual_sell_all', closedAt: timestamp } });
      console.log(JSON.stringify({ event: 'paper_emergency_exit', positionId: position.id, token: position.token, priceUsd: position.currentPriceUsd, reason: 'manual_sell_all' }));
    }
    return closed;
  }

  private reject(swap: ReturnType<RadarIngest['getRecentSwaps']>[number], reason: string, payload: Record<string, unknown> = {}): void {
    this.telemetry.emitEvent({ correlationId: TelemetryBus.correlationId('CANDIDATE'), module: 'strategy', event: 'paper_candidate_rejected', token: swap.targetToken, block: this.lastBlock, status: 'warning', payload: { reason, protocol: swap.protocol, pool: swap.pool, direction: swap.direction, quoteToken: swap.quoteToken, ...payload } });
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    const startedAt = Date.now();
    this.telemetry.emitEvent({ correlationId: TelemetryBus.correlationId('TICK'), module: 'strategy', event: 'paper_strategy_tick_started', block: this.lastBlock, status: 'ok', payload: { intervalMs: TICK_INTERVAL_MS } });
    try {
      const block = await this.client.getBlockNumber();
      this.lastBlock = block;
      const result = await this.ingest.poll(block, 25n);
      if (result === undefined) return;
      if (result.swaps.length > 0) console.log(JSON.stringify({ event: 'paper_strategy_swaps_received', count: result.swaps.length, fromBlock: result.fromBlock.toString(), toBlock: result.toBlock.toString() }));
      const pending: Promise<void>[] = [];
      for (const swap of result.swaps) {
        const key = `${swap.transactionHash}:${swap.logIndex}`;
        if (this.seen.has(key)) {
          this.telemetry.emitEvent({ correlationId: TelemetryBus.correlationId('DUP'), module: 'strategy', event: 'duplicate_swap_skipped', token: swap.targetToken, block: this.lastBlock, status: 'warning', payload: { key } });
          continue;
        }
        this.seen.add(key);
        if (this.seen.size > 5000) { const oldest = this.seen.values().next().value; if (typeof oldest === 'string') this.seen.delete(oldest); }
        pending.push(this.runSwapWithTimeout(swap));
        if (pending.length >= SWAP_WORKER_CONCURRENCY) {
          await Promise.allSettled(pending.splice(0, SWAP_WORKER_CONCURRENCY));
        }
      }
      if (pending.length > 0) await Promise.allSettled(pending);
    } catch (error) {
      console.warn(JSON.stringify({ event: 'paper_strategy_error', message: error instanceof Error ? error.message : String(error) }));
      this.telemetry.emitEvent({ correlationId: TelemetryBus.correlationId('STRATEGY'), module: 'strategy', event: 'paper_strategy_error', block: this.lastBlock, status: 'error', payload: { message: error instanceof Error ? error.message : String(error) } });
    } finally {
      const durationMs = Date.now() - startedAt;
      this.telemetry.emitEvent({ correlationId: TelemetryBus.correlationId('TICK'), module: 'strategy', event: 'paper_strategy_tick_completed', block: this.lastBlock, status: 'ok', payload: { durationMs } });
      this.ticking = false;
    }
  }

  private async runSwapWithTimeout(swap: ReturnType<RadarIngest['getRecentSwaps']>[number]): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.processSwap(swap),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`swap processing timeout after ${SWAP_TIMEOUT_MS}ms`)), SWAP_TIMEOUT_MS); }),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(JSON.stringify({ event: 'paper_swap_processing_error', token: swap.targetToken, message }));
      this.telemetry.emitEvent({ correlationId: TelemetryBus.correlationId('SWAP'), module: 'strategy', event: 'paper_swap_processing_error', token: swap.targetToken, block: this.lastBlock, status: 'error', payload: { message } });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async processSwap(swap: ReturnType<RadarIngest['getRecentSwaps']>[number]): Promise<void> {
    if (swap.status !== 'normalized' || swap.trader === undefined || swap.direction === 'UNKNOWN' || swap.amountIn === undefined || swap.amountOut === undefined) { this.reject(swap, 'invalid_normalized_swap'); return; }
    const market = await this.readMarket(swap.protocol, swap.pool, swap.targetToken, swap.quoteToken);
    if (market === undefined || market.priceUsd <= 0) { this.reject(swap, 'market_read_failed_or_invalid_price'); return; }
    const quoteAmountRaw = swap.direction === 'BUY' ? swap.amountIn : swap.amountOut;
    const quoteUsd = this.quoteToUsd(swap.quoteToken, quoteAmountRaw);
    if (quoteUsd <= 0) { this.reject(swap, 'unsupported_or_zero_quote_usd', { quoteAmountRaw: quoteAmountRaw.toString() }); return; }
    const flow = this.flow.process({ swap, trader: swap.trader, volumeUsd: quoteUsd, priceUsd: market.priceUsd, timestampMs: Date.now() });
    if (flow === undefined) { this.reject(swap, 'flow_rejected', { quoteUsd }); return; }
    this.latestFlows.set(swap.targetToken.toLowerCase(), flow);
    const liquidityScore = clamp((market.liquidityUsd / this.minLiquidityUsd) * 50, 0, 100);
    const riskScore = market.liquidityUsd >= this.minLiquidityUsd ? (market.liquidityUsd >= this.minLiquidityUsd * 4 ? 10 : 25) : 65;
    const breakoutScore = flow.priceChangePct >= 0.5 ? clamp(70 + flow.priceChangePct * 10, 70, 100) : 0;
    const signal = evaluateSignal({ flow, riskScore, liquidityScore, breakoutScore, liquidityUsd: market.liquidityUsd, minLiquidityUsd: this.minLiquidityUsd, minUniqueBuyerScore: MIN_UNIQUE_BUYER_SCORE });
    this.telemetry.emitEvent({ correlationId: TelemetryBus.correlationId('SIGNAL'), module: 'strategy', event: 'signal_evaluated', token: swap.targetToken, block: this.lastBlock, status: signal.entryQualified ? 'ok' : 'warning', payload: { signal: signal.signal, momentum: signal.momentum.score, risk: signal.risk.score, liquidityUsd: market.liquidityUsd, uniqueBuyers: flow.uniqueBuyers, buyPressurePct: flow.buyPressurePct, volumeAccelerationPct: flow.volumeAccelerationPct, priceChangePct: flow.priceChangePct, breakoutScore, protocol: swap.protocol } });
    if (!signal.entryQualified) { this.reject(swap, 'signal_not_entry_qualified', { signal: signal.signal, momentum: signal.momentum.score, risk: signal.risk.score, liquidityUsd: market.liquidityUsd, uniqueBuyers: flow.uniqueBuyers, buyPressurePct: flow.buyPressurePct, volumeAccelerationPct: flow.volumeAccelerationPct, priceChangePct: flow.priceChangePct, breakoutScore }); return; }
    if (!this.positions.canEnter()) { this.reject(swap, 'entries_disabled'); return; }
    if (this.positions.listOpen().some(position => position.token.toLowerCase() === swap.targetToken.toLowerCase())) { this.reject(swap, 'position_already_open'); return; }
    const best = chooseBestQuote([this.makePaperQuote(swap.targetToken, market.priceUsd, market.liquidityUsd, this.entrySizeUsd)]);
    if (best === undefined) { this.reject(swap, 'no_executable_quote'); return; }
    const correlationId = TelemetryBus.correlationId('ENTRY');
    const opportunity = opportunityId(++this.sequence);
    const fill = await this.execution.buy({ side: 'BUY', token: swap.targetToken, amountUsd: this.entrySizeUsd, quote: best.quote, correlationId });
    if (fill.fill.executedUsd <= 0) { this.reject(swap, 'paper_fill_zero', { requestedUsd: this.entrySizeUsd }); return; }
    const position: Position = { id: `${opportunity}-POS`, opportunityId: opportunity, token: swap.targetToken, symbol: swap.targetToken.slice(0, 8), state: 'DISCOVERED', entryPriceUsd: market.priceUsd, currentPriceUsd: market.priceUsd, peakPriceUsd: market.priceUsd, sizeUsd: fill.fill.executedUsd, momentumAtEntry: signal.momentum.score, momentumPeak: signal.momentum.score, openedAt: Date.now(), updatedAt: Date.now() };
    this.positions.add(position);
    this.positions.transition(position.id, 'QUALIFIED');
    this.positions.transition(position.id, 'SIGNAL');
    this.positions.transition(position.id, 'ENTRY');
    this.positions.transition(position.id, 'OPEN');
    this.positionMarkets.set(position.id, { protocol: swap.protocol ?? V2_PROTOCOL, pool: swap.pool, quote: swap.quoteToken as Addr });
    this.telemetry.emitEvent({ correlationId, module: 'positions', event: 'paper_position_opened', token: swap.targetToken, status: 'ok', payload: { positionId: position.id, opportunityId: opportunity, entryPriceUsd: market.priceUsd, sizeUsd: fill.fill.executedUsd, momentum: signal.momentum.score, entryCostUsd: fill.fill.cost.totalUsd } });
    console.log(JSON.stringify({ event: 'paper_entry', positionId: position.id, token: swap.targetToken, priceUsd: market.priceUsd, sizeUsd: fill.fill.executedUsd, momentum: signal.momentum.score, costUsd: fill.fill.cost.totalUsd }));
  }

  private async markToMarketSafely(): Promise<void> {
    if (this.marking) return;
    this.marking = true;
    try { await this.markToMarket(); }
    catch (error) { console.warn(JSON.stringify({ event: 'paper_mark_error', message: error instanceof Error ? error.message : String(error) })); }
    finally { this.marking = false; }
  }

  private async markToMarket(): Promise<void> {
    for (const position of this.positions.listOpen()) {
      const marketRef = this.positionMarkets.get(position.id);
      if (marketRef === undefined) continue;
      const market = await this.readMarket(marketRef.protocol, marketRef.pool, position.token, marketRef.quote);
      if (market === undefined || market.priceUsd <= 0) continue;
      const flow = this.latestFlows.get(position.token.toLowerCase());
      const momentum = flow === undefined ? position.momentumPeak : evaluateSignal({ flow, riskScore: 10, liquidityScore: 100, breakoutScore: 70, liquidityUsd: market.liquidityUsd, minLiquidityUsd: this.minLiquidityUsd, minUniqueBuyerScore: MIN_UNIQUE_BUYER_SCORE }).momentum.score;
      const update = this.positions.updateMarket(position.id, { priceUsd: market.priceUsd, momentum, volumeAcceleration: flow?.volumeAccelerationPct ?? 0, timestamp: Date.now() });
      const pnlUsd = update.position.entryPriceUsd > 0 ? update.position.sizeUsd * ((update.position.currentPriceUsd / update.position.entryPriceUsd) - 1) : 0;
      const pnlPct = update.position.entryPriceUsd > 0 ? ((update.position.currentPriceUsd / update.position.entryPriceUsd) - 1) * 100 : 0;
      this.telemetry.emitEvent({ correlationId: TelemetryBus.correlationId('MARK'), module: 'positions', event: 'paper_position_mark', token: position.token, status: 'ok', payload: { positionId: position.id, currentPriceUsd: update.position.currentPriceUsd, pnlUsd, pnlPct, state: update.position.state, momentum, momentumPeak: update.position.momentumPeak, volumeAcceleration: flow?.volumeAccelerationPct ?? 0, exitAction: update.decision.action, exitReason: update.decision.reason } });
      if (update.decision.action !== 'SELL') continue;
      const best = chooseBestQuote([this.makePaperQuote(position.token, market.priceUsd, market.liquidityUsd, position.sizeUsd, pnlUsd + position.sizeUsd)]);
      if (best === undefined) { console.warn(JSON.stringify({ event: 'paper_exit_waiting_for_quote', positionId: position.id, reason: 'no_executable_quote' })); continue; }
      const exitCorrelationId = TelemetryBus.correlationId('EXIT');
      const sell = await this.execution.sell({ side: 'SELL', token: position.token, amountUsd: position.sizeUsd, quote: best.quote, correlationId: exitCorrelationId });
      const exitValueUsd = sell.fill.executedUsd;
      const netPnlUsd = exitValueUsd - position.sizeUsd;
      const netPnlPct = position.sizeUsd > 0 ? (netPnlUsd / position.sizeUsd) * 100 : 0;
      this.positions.close(position.id);
      this.positionMarkets.delete(position.id);
      this.telemetry.emitEvent({ correlationId: exitCorrelationId, module: 'positions', event: 'paper_position_closed', token: position.token, status: 'ok', payload: { positionId: position.id, opportunityId: position.opportunityId, entryPriceUsd: position.entryPriceUsd, exitPriceUsd: market.priceUsd, sizeUsd: position.sizeUsd, exitValueUsd, grossPnlUsd: pnlUsd, grossPnlPct: pnlPct, exitCostUsd: sell.fill.cost.totalUsd, netPnlUsd, netPnlPct, reason: update.decision.reason, closedAt: Date.now() } });
      console.log(JSON.stringify({ event: 'paper_exit', positionId: position.id, priceUsd: market.priceUsd, pnlUsd: netPnlUsd, pnlPct: netPnlPct, grossPnlUsd: pnlUsd, exitCostUsd: sell.fill.cost.totalUsd, reason: update.decision.reason }));
    }
  }

  private makePaperQuote(token: Addr, priceUsd: number, liquidityUsd: number, amountUsd: number, expectedAmountOutUsd = amountUsd): ExecutionQuote {
    const fee = amountUsd * (PAPER_DEX_FEE_PCT / 100);
    const impact = amountUsd * Math.min(0.03, amountUsd / Math.max(liquidityUsd, 1));
    const slippage = amountUsd * (PAPER_SLIPPAGE_PCT / 100);
    return { dexId: 'paper-router', token, amountInUsd: amountUsd, expectedAmountOutUsd, executablePriceUsd: priceUsd, dexFeeUsd: fee, slippageUsd: slippage, priceImpactUsd: impact, gasEstimate: PAPER_GAS_LIMIT, gasPriceWei: PAPER_GAS_PRICE_GWEI, nativeTokenUsd: PAPER_ETH_USD, quotedAt: Date.now(), latencyMs: 25 };
  }

  private quoteToUsd(token: Addr | undefined, amount: bigint): number {
    if (token === undefined) return 0;
    const normalized = token.toLowerCase();
    if (normalized === USDG) return Number(amount) / 1e18;
    if (normalized === WETH) return (Number(amount) / 1e18) * PAPER_ETH_USD;
    return 0;
  }

  private async readMarket(protocol: string | undefined, pool: Addr, target: Addr, quote: Addr | undefined): Promise<PoolMarket | undefined> {
    if (quote === undefined) return undefined;
    const key = `${protocol ?? V2_PROTOCOL}:${pool.toLowerCase()}:${target.toLowerCase()}:${quote.toLowerCase()}`;
    const cached = this.marketCache.get(key);
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.market;
    const existing = this.marketInFlight.get(key);
    if (existing !== undefined) return existing;
    const request = protocol === 'uniswap-v3' ? this.readV3Market(pool, target, quote) : this.readV2Market(pool, target, quote);
    this.marketInFlight.set(key, request);
    try {
      const market = await request;
      if (market !== undefined && market.priceUsd > 0) this.marketCache.set(key, { market, expiresAt: Date.now() + MARKET_CACHE_TTL_MS });
      return market;
    } finally {
      this.marketInFlight.delete(key);
    }
  }

  private async readV2Market(pool: Addr, target: Addr, quote: Addr | undefined): Promise<PoolMarket | undefined> {
    if (quote === undefined) return undefined;
    try {
      const [token0, token1, reserves, targetDecimals] = await Promise.all([
        this.client.readContract({ address: pool, abi: V2, functionName: 'token0' }),
        this.client.readContract({ address: pool, abi: V2, functionName: 'token1' }),
        this.client.readContract({ address: pool, abi: V2, functionName: 'getReserves' }),
        this.client.readContract({ address: target, abi: ERC20, functionName: 'decimals' }),
      ]);
      const [reserve0, reserve1] = reserves as readonly [bigint, bigint, number];
      const targetIs0 = (token0 as string).toLowerCase() === target.toLowerCase();
      const targetReserve = targetIs0 ? reserve0 : reserve1;
      const quoteReserve = targetIs0 ? reserve1 : reserve0;
      const quoteUsd = this.quoteToUsd(quote, quoteReserve);
      const targetUnits = Number(targetReserve) / 10 ** Number(targetDecimals);
      if (targetUnits <= 0 || quoteUsd <= 0) return undefined;
      return { liquidityUsd: quoteUsd * 2, priceUsd: quoteUsd / targetUnits, quotePriceUsd: normalizedQuotePrice(quote) };
    } catch { return undefined; }
  }

  private async readV3Market(pool: Addr, target: Addr, quote: Addr | undefined): Promise<PoolMarket | undefined> {
    if (quote === undefined) return undefined;
    try {
      const token0 = await this.client.readContract({ address: pool, abi: V3, functionName: 'token0' }) as Addr;
      const token1 = await this.client.readContract({ address: pool, abi: V3, functionName: 'token1' }) as Addr;
      const [slot0, liquidity] = await Promise.all([
        this.client.readContract({ address: pool, abi: V3, functionName: 'slot0' }),
        this.client.readContract({ address: pool, abi: V3, functionName: 'liquidity' }),
      ]);
      const [decimals0, decimals1] = await Promise.all([
        this.client.readContract({ address: token0, abi: ERC20, functionName: 'decimals' }),
        this.client.readContract({ address: token1, abi: ERC20, functionName: 'decimals' }),
      ]);
      const sqrtPriceX96 = (slot0 as readonly [bigint, number, number, number, number, number, boolean])[0];
      const pRaw = Number(sqrtPriceX96) ** 2 / 2 ** 192;
      if (!Number.isFinite(pRaw) || pRaw <= 0) return undefined;
      const d0 = Number(decimals0);
      const d1 = Number(decimals1);
      const targetIs0 = token0.toLowerCase() === target.toLowerCase();
      const quoteUsd = normalizedQuotePrice(quote);
      const priceUsd = targetIs0 ? pRaw * 10 ** (d0 - d1) * quoteUsd : (1 / pRaw) * 10 ** (d1 - d0) * quoteUsd;
      const L = Number(liquidity);
      if (!Number.isFinite(L) || L <= 0 || priceUsd <= 0) return undefined;
      const sqrtP = Number(sqrtPriceX96) / 2 ** 96;
      const virtual0 = L / sqrtP / 10 ** d0;
      const virtual1 = L * sqrtP / 10 ** d1;
      const liqUsd = targetIs0 ? (virtual0 * priceUsd + virtual1 * quoteUsd) : (virtual0 * quoteUsd + virtual1 * priceUsd);
      return { liquidityUsd: finite(liqUsd), priceUsd: finite(priceUsd), quotePriceUsd: quoteUsd };
    } catch { return undefined; }
  }
}

function normalizedQuotePrice(token: Addr): number { return token.toLowerCase() === USDG ? 1 : PAPER_ETH_USD; }
