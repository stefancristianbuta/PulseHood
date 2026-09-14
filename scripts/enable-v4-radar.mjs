import fs from 'node:fs';

const path = new URL('../src/radar-ingest.ts', import.meta.url);
let s = fs.readFileSync(path, 'utf8');

if (!s.includes('V4_INITIALIZE')) {
  s = s.replace(
    "const V2_SWAP=parseAbi(['event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)']);",
    "const V2_SWAP=parseAbi(['event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)']);\nconst V4_INITIALIZE=parseAbi(['event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks)']);\nconst V4_SWAP=parseAbi(['event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)']);"
  );
  s = s.replace(
    "type Client=PublicClient<Transport>; type EventProtocol='v2'|'v3';\ninterface PoolTokens{token0:`0x${string}`;token1:`0x${string}`}\n",
    "type Client=PublicClient<Transport>; type EventProtocol='v2'|'v3';\ninterface PoolTokens{token0:`0x${string}`;token1:`0x${string}`}\ninterface V4Pool{token0:`0x${string}`;token1:`0x${string}`}\n"
  );
  s = s.replace(
    "const deployments=DEFAULT_DEX_REGISTRY.listEnabled();",
    "const deployments=DEFAULT_DEX_REGISTRY.listEnabled();\nconst V4_MANAGER=deployments.find(d=>d.protocol==='uniswap-v4')?.poolManager?.toLowerCase();"
  );
  s = s.replace(
    "private readonly poolTokens=new Map<string,PoolTokens>(); private readonly poolProtocols=new Map<string,DexProtocol>();",
    "private readonly poolTokens=new Map<string,PoolTokens>(); private readonly poolProtocols=new Map<string,DexProtocol>(); private readonly v4Pools=new Map<string,V4Pool>();"
  );
  const marker = " private async normalize(abi:readonly unknown[],logs:any[],kind:EventProtocol){";
  const v4fn = ` private async normalizeV4(logs:any[]){const out:NormalizedSwap[]=[];for(const log of logs){if(log.transactionHash===null||log.logIndex===undefined)continue;try{const decoded=decodeEventLog({abi:V4_SWAP,topics:log.topics,data:log.data});const args=decoded.args as Record<string,unknown>;const id=String(args.id).toLowerCase();const p=this.v4Pools.get(id);if(!p)continue;const q0=isQuote(p.token0),q1=isQuote(p.token1);if(q0===q1)continue;const targetToken=q0?p.token1:p.token0;const amount0=BigInt(args.amount0 as bigint),amount1=BigInt(args.amount1 as bigint);const targetIs0=targetToken.toLowerCase()===p.token0.toLowerCase();const targetAmount=targetIs0?amount0:amount1;const quoteAmount=targetIs0?amount1:amount0;const direction=targetAmount<0n&&quoteAmount>0n?'BUY':targetAmount>0n&&quoteAmount<0n?'SELL':'UNKNOWN';if(direction==='UNKNOWN')continue;const trader=typeof args.sender==='string'&&/^0x[0-9a-fA-F]{40}$/.test(args.sender)?args.sender as \`0x\${string}\`:undefined;out.push({status:'normalized',protocol:'uniswap-v4',eventName:'Swap',pool:log.address as \`0x\${string}\`,transactionHash:log.transactionHash,logIndex:Number(log.logIndex),direction,targetToken,quoteToken:q0?p.token0:p.token1,amountIn:direction==='BUY'?quoteAmount:targetAmount,amountOut:direction==='BUY'?-targetAmount:-quoteAmount,trader,reason:undefined});}catch{}}return out}\n`;
  if (s.includes(marker) && !s.includes('normalizeV4(logs:any[])')) s=s.replace(marker,v4fn+marker);
  const oldPoll = "const[v3Logs,v2Logs]=await Promise.all([this.getLogs(V3_SWAP,from,to),this.getLogs(V2_SWAP,from,to)]);const[v3,v2]=await Promise.all([this.normalize(V3_SWAP,v3Logs,'v3'),this.normalize(V2_SWAP,v2Logs,'v2')]);const swaps=[...v3,...v2].sort((a,b)=>a.logIndex-b.logIndex);";
  const newPoll = "const[v3Logs,v2Logs,v4InitLogs,v4SwapLogs]=await Promise.all([this.getLogs(V3_SWAP,from,to),this.getLogs(V2_SWAP,from,to),V4_MANAGER?this.getLogs(V4_INITIALIZE,from,to,V4_MANAGER as \`0x\${string}\`):Promise.resolve([]),V4_MANAGER?this.getLogs(V4_SWAP,from,to,V4_MANAGER as \`0x\${string}\`):Promise.resolve([])]);for(const log of v4InitLogs){try{const decoded=decodeEventLog({abi:V4_INITIALIZE,topics:log.topics,data:log.data});const a=decoded.args as Record<string,unknown>;if(typeof a.id==='string'&&typeof a.currency0==='string'&&typeof a.currency1==='string')this.v4Pools.set(a.id.toLowerCase(),{token0:a.currency0 as \`0x\${string}\`,token1:a.currency1 as \`0x\${string}\`});}catch{}}const[v3,v2,v4]=await Promise.all([this.normalize(V3_SWAP,v3Logs,'v3'),this.normalize(V2_SWAP,v2Logs,'v2'),this.normalizeV4(v4SwapLogs)]);const swaps=[...v3,...v2,...v4].sort((a,b)=>a.logIndex-b.logIndex);";
  if (s.includes(oldPoll)) s=s.replace(oldPoll,newPoll);
  s=s.replace("rawV3Logs:v3Logs.length,rawV2Logs:v2Logs.length,fromBlock:from.toString(),toBlock:to.toString()", "rawV3Logs:v3Logs.length,rawV2Logs:v2Logs.length,rawV4InitializeLogs:v4InitLogs.length,rawV4SwapLogs:v4SwapLogs.length,dexCounts:swaps.reduce<Record<string,number>>((m,s)=>{m[s.protocol??'unknown']=(m[s.protocol??'unknown']??0)+1;return m},{}),fromBlock:from.toString(),toBlock:to.toString()")
  s=s.replace("this.poolTokens.clear();this.poolProtocols.clear();this.seeded=false", "this.poolTokens.clear();this.poolProtocols.clear();this.v4Pools.clear();this.seeded=false");
  fs.writeFileSync(path,s);
  console.log(JSON.stringify({event:'v4_radar_patch',enabled:Boolean(s.includes('normalizeV4(logs:any[])')),poolManager:V4_MANAGER}));
} else {
  console.log(JSON.stringify({event:'v4_radar_patch',status:'already_applied'}));
}
