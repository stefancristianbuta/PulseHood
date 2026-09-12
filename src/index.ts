import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { WebSocketChainFeed } from './chain-feed.js';
import { DEFAULT_DEX_REGISTRY } from './dex-registry.js';
import { calculateMomentum } from './momentum.js';
import { classifyRisk } from './risk.js';
import { RpcManager } from './rpc.js';
import { scanContract } from './scan.js';
import { TelemetryBus } from './telemetry.js';

const config = loadConfig();
const telemetry = new TelemetryBus();
const rpc = new RpcManager(config.rpcUrls, telemetry, config.maxRpcLatencyMs, config.maxBlockLag);

const serializableRpcStatus = () => rpc.getStatus().map((endpoint) => ({
  ...endpoint,
  blockNumber: endpoint.blockNumber?.toString() ?? null,
}));

const dashboardHtml = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#07090d"><title>PulseHood</title>
<style>
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif;background:#07090d;color:#f5f7fa}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 0,#18202b 0,#07090d 45%);min-height:100vh}
.shell{max-width:1100px;margin:auto;padding:18px 16px 100px}.top{display:flex;justify-content:space-between;gap:12px;align-items:center}.brand{font-size:24px;font-weight:800;letter-spacing:-.04em}.sub{font-size:12px;color:#8d98a8;margin-top:3px}.pill{padding:7px 10px;border:1px solid #26303d;border-radius:999px;font-size:12px;color:#aeb8c5;background:#0c1016}.pill.ok{color:#a8f3c1;border-color:#245b3a}.pill.warn{color:#ffd68a;border-color:#5d4a20}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:18px}.card{background:#0d1117;border:1px solid #202834;border-radius:16px;padding:14px;box-shadow:0 10px 30px #0005}.label{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:#7f8a99}.value{font-size:20px;font-weight:750;margin-top:6px}.muted{color:#8c97a6}.tabs{display:flex;gap:6px;overflow:auto;margin:18px 0 12px;padding-bottom:2px}.tab{border:1px solid #252d39;background:#0c1016;color:#aab4c1;padding:10px 14px;border-radius:11px;white-space:nowrap}.tab.active{background:#f5f7fa;color:#080a0d}.panel{display:none}.panel.active{display:block}.row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid #1c232d}.row:last-child{border-bottom:0}.badge{font-size:11px;padding:5px 8px;border-radius:8px;background:#151b23;color:#aeb8c5}.badge.live{color:#a8f3c1}.badge.off{color:#ffb0b0}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.empty{padding:28px 8px;text-align:center;color:#7e8997}.scan{display:flex;gap:8px}.scan input{flex:1;min-width:0;background:#090c11;border:1px solid #2a3340;color:#fff;border-radius:11px;padding:12px}.btn{border:1px solid #2c3643;background:#141a22;color:#fff;border-radius:11px;padding:11px 14px;font-weight:700}.btn.primary{background:#f5f7fa;color:#07090d}.btn.danger{background:#2a1114;border-color:#5a252b;color:#ffb5bb}.controls{display:flex;gap:8px;flex-wrap:wrap}.footer{position:fixed;bottom:0;left:0;right:0;background:#090c11ee;backdrop-filter:blur(18px);border-top:1px solid #1e2631;padding:10px 14px;display:flex;justify-content:center;gap:8px}.small{font-size:12px}.section-title{font-size:16px;font-weight:750;margin:4px 0 12px}@media(max-width:720px){.grid{grid-template-columns:repeat(2,1fr)}.shell{padding-top:12px}.top{align-items:flex-start}}
</style>
</head>
<body><div class="shell">
<header class="top"><div><div class="brand">PulseHood</div><div class="sub">Robinhood Chain momentum radar · paper trading</div></div><div id="health" class="pill">CONNECTING</div></header>
<section class="grid">
<div class="card"><div class="label">Chain</div><div id="chain" class="value">4663</div></div>
<div class="card"><div class="label">Latest block</div><div id="block" class="value">—</div></div>
<div class="card"><div class="label">RPC</div><div id="rpc" class="value">—</div></div>
<div class="card"><div class="label">Mode</div><div id="mode" class="value">PAPER</div></div>
</section>
<nav class="tabs">
<button class="tab active" data-tab="radar">Radar</button><button class="tab" data-tab="scan">Scan</button><button class="tab" data-tab="positions">Positions</button><button class="tab" data-tab="settings">Settings</button><button class="tab" data-tab="system">System</button>
</nav>
<section id="radar" class="panel active"><div class="card"><div class="section-title">Live radar</div><div id="radarBody" class="empty">Waiting for normalized swap flow. Chain connectivity is online; candidate qualification is not yet producing live signals.</div></div><div class="card" style="margin-top:10px"><div class="section-title">Verified DEX registry</div><div id="dexList"></div></div></section>
<section id="scan" class="panel"><div class="card"><div class="section-title">Contract scan</div><div class="scan"><input id="scanInput" placeholder="0x token contract address" autocomplete="off"><button class="btn primary" id="scanBtn">Scan</button></div><div id="scanResult" class="empty">Checks EVM address, contract bytecode, ERC-20 symbol and decimals on Robinhood Chain.</div></div></section>
<section id="positions" class="panel"><div class="card"><div class="section-title">Paper positions</div><div class="empty">No runtime positions are open. Position engine remains paper-only and will populate this view when a qualified signal reaches ENTRY.</div></div></section>
<section id="settings" class="panel"><div class="card"><div class="section-title">Runtime policy</div><div class="row"><span>Trading mode</span><span class="badge live">PAPER</span></div><div class="row"><span>Live execution</span><span class="badge off">DISABLED</span></div><div class="row"><span>Paper capital</span><span class="mono">$${config.paperCapitalUsd.toLocaleString()}</span></div><div class="row"><span>RPC latency policy</span><span class="mono">≤ ${config.maxRpcLatencyMs} ms</span></div><div class="row"><span>Max block lag</span><span class="mono">${config.maxBlockLag}</span></div></div></section>
<section id="system" class="panel"><div class="card"><div class="section-title">System telemetry</div><div id="rpcList"></div></div></section>
</div><div class="footer"><button class="btn danger" id="stopBtn">STOP BOT</button><button class="btn danger" id="sellBtn">SELL ALL</button></div>
<script>
const qs=s=>document.querySelector(s); const tabs=[...document.querySelectorAll('.tab')];
tabs.forEach(b=>b.onclick=()=>{tabs.forEach(x=>x.classList.remove('active'));document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');qs('#'+b.dataset.tab).classList.add('active')});
const esc=s=>String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
async function refresh(){try{const r=await fetch('/api/status',{cache:'no-store'});const d=await r.json();qs('#health').textContent=d.rpcReady?'RPC READY':'RPC DEGRADED';qs('#health').className='pill '+(d.rpcReady?'ok':'warn');qs('#chain').textContent=d.chainId;qs('#block').textContent=d.latestBlock||'—';const live=d.rpcStatus.filter(x=>x.failures===0).length;qs('#rpc').textContent=live+'/'+d.rpcStatus.length;qs('#mode').textContent=d.tradingMode.toUpperCase();qs('#rpcList').innerHTML=d.rpcStatus.map(x=>'<div class="row"><span class="mono">'+esc(x.url)+'</span><span><span class="badge '+(x.healthy?'live':'')+'">'+(x.healthy?'HEALTHY':'DEGRADED')+'</span> <span class="small muted">'+(x.latencyMs==null?'—':Math.round(x.latencyMs)+' ms')+'</span></span></div>').join('');}catch(e){qs('#health').textContent='OFFLINE';qs('#health').className='pill warn'}}
async function loadDex(){try{const r=await fetch('/api/dex',{cache:'no-store'});const d=await r.json();qs('#dexList').innerHTML=d.map(x=>'<div class="row"><span><b>'+esc(x.name)+'</b><div class="small muted">'+esc(x.protocol)+'</div></span><span class="badge live">VERIFIED</span></div>').join('')}catch{}}
qs('#scanBtn').onclick=async()=>{const input=qs('#scanInput').value.trim();qs('#scanResult').textContent='Scanning…';try{const r=await fetch('/api/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({address:input})});const d=await r.json();qs('#scanResult').innerHTML=d.error?'<span class="badge off">'+esc(d.error)+'</span>':'<div><b>'+esc(d.symbol||'ERC-20')+'</b> · '+esc(d.address)+'<div class="small muted">Contract: '+(d.isContract?'yes':'no')+' · decimals: '+esc(d.decimals??'—')+' · chain: '+esc(d.chainId)+'</div></div>'}catch{qs('#scanResult').textContent='Scan request failed'}};
qs('#stopBtn').onclick=async()=>{const r=await fetch('/api/control/stop',{method:'POST'});const d=await r.json();alert(d.message)};
qs('#sellBtn').onclick=async()=>{const r=await fetch('/api/control/sell-all',{method:'POST'});const d=await r.json();alert(d.message)};
refresh();loadDex();setInterval(refresh,5000);
</script></body></html>`;

async function main(): Promise<void> {
  if (config.tradingMode !== 'paper' || config.liveEnabled) {
    throw new Error('Deploy safety gate: only paper mode is permitted in this V1 runtime');
  }

  const momentum = calculateMomentum({
    priceAcceleration: 0,
    volumeAcceleration: 0,
    buyPressure: 0,
    uniqueBuyerScore: 0,
    liquidityScore: 0,
    breakoutScore: 0,
  });
  const risk = classifyRisk(100);

  let latestBlock: bigint | undefined;
  let rpcReady = false;
  let rpcChainId: number | undefined;
  let feedIndex = 0;
  let entriesEnabled = true;

  const feeds = config.wsUrls.map((url) => new WebSocketChainFeed(url, telemetry));

  const readBody = async (req: import('node:http').IncomingMessage): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  };

  const json = (res: import('node:http').ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/api/status' || req.url === '/health') {
        json(res, 200, {
          app: 'PulseHood', status: 'ok', chainId: config.chainId, tradingMode: config.tradingMode,
          liveEnabled: config.liveEnabled, entriesEnabled, rpcReady, rpcChainId: rpcChainId ?? null,
          latestBlock: latestBlock?.toString() ?? null, rpcStatus: serializableRpcStatus(),
        });
        return;
      }
      if (req.url === '/api/dex' && req.method === 'GET') {
        json(res, 200, DEFAULT_DEX_REGISTRY.listEnabled().map(({ id, name, protocol, verifiedAt }) => ({ id, name, protocol, verifiedAt })));
        return;
      }
      if (req.url === '/api/scan' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { address?: string };
        const result = await scanContract(body.address ?? '', rpc, telemetry);
        json(res, 200, result);
        return;
      }
      if (req.url === '/api/control/stop' && req.method === 'POST') {
        entriesEnabled = false;
        telemetry.emitEvent({ correlationId: TelemetryBus.correlationId('CONTROL'), module: 'control', event: 'stop_bot', status: 'warning' });
        json(res, 200, { ok: true, entriesEnabled, message: 'New entries stopped. Existing paper positions are not force-closed.' });
        return;
      }
      if (req.url === '/api/control/resume' && req.method === 'POST') {
        entriesEnabled = true;
        telemetry.emitEvent({ correlationId: TelemetryBus.correlationId('CONTROL'), module: 'control', event: 'resume_bot', status: 'ok' });
        json(res, 200, { ok: true, entriesEnabled, message: 'New entries enabled.' });
        return;
      }
      if (req.url === '/api/control/sell-all' && req.method === 'POST') {
        telemetry.emitEvent({ correlationId: TelemetryBus.correlationId('CONTROL'), module: 'control', event: 'sell_all', status: 'warning', payload: { closedPositions: 0 } });
        json(res, 200, { ok: true, closedPositions: 0, message: 'SELL ALL executed: there are currently no active runtime paper positions.' });
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(dashboardHtml());
    } catch (error) {
      json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  const port = Number(process.env.PORT ?? 10000);
  server.listen(port, '0.0.0.0', () => {
    console.log(JSON.stringify({ app: 'PulseHood', chainId: config.chainId, tradingMode: config.tradingMode, liveEnabled: config.liveEnabled, rpcEndpoints: config.rpcUrls.length, wsEndpoints: config.wsUrls.length, momentum, risk, httpPort: port }, null, 2));
  });

  const probeRpc = async (): Promise<void> => {
    try {
      await rpc.probe();
      const client = rpc.getClient();
      const chainId = await client.getChainId();
      if (chainId !== config.chainId) throw new Error(`RPC chain mismatch: expected ${config.chainId}, received ${chainId}`);
      rpcChainId = chainId;
      rpcReady = true;
      console.log(JSON.stringify({ event: 'rpc_ready', chainId, rpcStatus: serializableRpcStatus() }));
      telemetry.emitEvent({ correlationId: TelemetryBus.correlationId('RPC'), module: 'rpc', event: 'ready', status: 'ok', payload: { chainId } });
    } catch (error) {
      rpcReady = false;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(JSON.stringify({ event: 'rpc_unavailable', message, rpcStatus: serializableRpcStatus() }));
      telemetry.emitEvent({ correlationId: TelemetryBus.correlationId('RPC'), module: 'rpc', event: 'unavailable_retrying', status: 'warning', payload: { error: message } });
    }
  };

  await probeRpc();
  const rpcRetry = setInterval(() => { void probeRpc(); }, 15_000);

  const pollBlock = async (): Promise<void> => {
    if (!rpcReady) return;
    try {
      const block = await rpc.getClient().getBlock({ includeTransactions: false });
      if (latestBlock === undefined || block.number > latestBlock) {
        latestBlock = block.number;
        telemetry.emitEvent({ correlationId: TelemetryBus.correlationId('RADAR'), module: 'radar', event: 'block_polled', block: block.number, status: 'ok', payload: { transactionCount: block.transactions.length, source: 'rpc-poll' } });
      }
    } catch (error) {
      telemetry.emitEvent({ correlationId: TelemetryBus.correlationId('RADAR'), module: 'radar', event: 'block_poll_error', status: 'warning', payload: { error: error instanceof Error ? error.message : String(error) } });
    }
  };
  await pollBlock();
  const blockPoller = setInterval(() => { void pollBlock(); }, 2_000);

  const startFeed = (): void => {
    const feed = feeds[feedIndex];
    if (feed === undefined) throw new Error('No WebSocket feed configured');
    feed.start(async (block) => {
      latestBlock = block.number;
      telemetry.emitEvent({ correlationId: TelemetryBus.correlationId('RADAR'), module: 'radar', event: 'block_ingested', block: block.number, status: 'ok', payload: { transactionCount: block.transactionHashes.length, feedIndex, source: 'websocket' } });
    });
  };
  startFeed();

  const heartbeat = setInterval(() => {
    telemetry.emitEvent({ correlationId: TelemetryBus.correlationId('HEARTBEAT'), module: 'app', event: 'heartbeat', status: 'ok', payload: { latestBlock: latestBlock?.toString() ?? null, feedIndex, rpcReady, entriesEnabled, tradingMode: config.tradingMode, liveEnabled: config.liveEnabled } });
  }, 30_000);

  const shutdown = (): void => {
    clearInterval(heartbeat); clearInterval(rpcRetry); clearInterval(blockPoller);
    for (const feed of feeds) feed.stop();
    server.close(); console.log('PulseHood shutdown complete');
  };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
