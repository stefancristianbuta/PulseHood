import fs from 'node:fs';

const runtimePath = new URL('../src/trading-runtime.ts', import.meta.url);
let runtime = fs.readFileSync(runtimePath, 'utf8');
const needle = "protocol: swap.protocol } });";
const replacement = "protocol: swap.protocol, quoteToken: swap.quoteToken, poolId: swap.poolId ?? null, token0: swap.token0 ?? null, token1: swap.token1 ?? null } });";
if (runtime.includes(needle) && !runtime.includes('poolId: swap.poolId ?? null')) runtime = runtime.replace(needle, replacement);
fs.writeFileSync(runtimePath, runtime);

const indexPath = new URL('../src/index.ts', import.meta.url);
let index = fs.readFileSync(indexPath, 'utf8');
index = index.replace("type Candidate = { token:string; protocol:string; pool:string; direction:string;", "type Candidate = { token:string; protocol:string; pool:string; quoteToken?:string|null; poolId?:string|null; token0?:string|null; token1?:string|null; tokenName?:string; tokenSymbol?:string; direction:string;");
const oldReturn = "return {...statusBase(),positions:enriched,paperSummary:summary,paperHistory:history};";
const newReturn = "const radar=await Promise.all([...state.candidates.values()].sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,100).map(async c=>({...c,tokenSymbol:await tokenSymbol(c.token),tokenName:await tokenSymbol(c.token)})));return {...statusBase(),candidates:radar,positions:enriched,paperSummary:summary,paperHistory:history};";
if (index.includes(oldReturn) && !index.includes('const radar=await Promise.all')) index = index.replace(oldReturn, newReturn);
const marker = "async function refresh";
const extra = `function renderRadar(rows){if(!rows.length){$('#radarBody').innerHTML='<div class="empty">Waiting…</div>';return}$('#radarBody').innerHTML=rows.map(c=>{const v4=c.protocol==='uniswap-v4';const name=c.tokenName&&c.tokenName!=='TOKEN'?c.tokenName:(c.tokenSymbol&&c.tokenSymbol!=='TOKEN'?c.tokenSymbol:short(c.token));const details=v4?'<div class="muted mono">V4 · Pool '+esc(c.poolId??'unresolved')+'</div><div class="muted mono">0 '+esc(short(c.token0??''))+' · 1 '+esc(short(c.token1??''))+'</div>':'<div class="muted">'+esc(c.protocol??'DEX')+'</div>';return '<div class="r"><span><b>'+esc(name)+'</b><div class="muted mono">'+esc(c.token)+'</div>'+details+'</span><span>'+fmt(c.momentum)+'</span><span>'+fmt(c.risk)+'</span><span>'+fmt(c.buyPressurePct)+'%</span><span>'+fmt(c.volumeAccelerationPct)+'%</span><span>'+fmt(c.uniqueBuyers)+'</span><span>$'+fmt(c.liquidityUsd)+'</span><b>'+esc(c.signal)+'</b></div>'}).join('')}`;
if (index.includes(marker) && !index.includes("function renderRadar(rows){if(!rows.length")) index = index.replace(marker, extra + '\n' + marker);
fs.writeFileSync(indexPath, index);
console.log(JSON.stringify({event:'v4_ui_patch',tokenDetails:true,poolId:true,token0:true,token1:true,signalMetadata:true}));
