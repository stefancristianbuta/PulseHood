import { decodeEventLog, parseAbi, type PublicClient, type Transport } from 'viem';
import type { NormalizedSwap } from './swap-event.js';
import { normalizeSwapEvent } from './swap-event.js';
import { DEFAULT_DEX_REGISTRY, type DexProtocol } from './dex-registry.js';

const WETH='0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'.toLowerCase();
const USDG='0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'.toLowerCase();
const V3_SWAP=parseAbi(['event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)']);
const V2_SWAP=parseAbi(['event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)']);
const TOKEN_ABI=parseAbi(['function token0() view returns (address)','function token1() view returns (address)']);
const FACTORY_ABI=parseAbi(['function factory() view returns (address)']);
type Client=PublicClient<Transport>;
type EventProtocol='v2'|'v3';
interface PoolTokens{token0:`0x${string}`;token1:`0x${string}`}
export interface RadarIngestResult{swaps:NormalizedSwap[];fromBlock:bigint;toBlock:bigint}
const deployments=DEFAULT_DEX_REGISTRY.listEnabled();
const factoryToProtocol=new Map<string,DexProtocol>();
for(const d of deployments)if(d.factory)factoryToProtocol.set(d.factory.toLowerCase(),d.protocol);
const V2_PROTOCOLS=new Set<DexProtocol>(['uniswap-v2','pons-v2','pancakeswap-v2']);
const V3_PROTOCOLS=new Set<DexProtocol>(['uniswap-v3','ramses-v3','sushiswap-v3','pancakeswap-v3','robinswap-v3','parityswap-v3','sheriff-v3','giga-v3']);
function isQuote(t:`0x${string}`){const a=t.toLowerCase();return a===WETH||a===USDG}
export class RadarIngest{
 private readonly poolTokens=new Map<string,PoolTokens>();
 private readonly poolProtocols=new Map<string,DexProtocol>();
 private lastBlock:bigint|undefined; private recentSwaps:NormalizedSwap[]=[]; private seeded=false;
 constructor(private readonly client:Client,private readonly maxRecentSwaps=200){}
 async seedPools(){if(this.seeded)return;this.seeded=true;console.log(JSON.stringify({event:'pool_seed_dynamic',mode:'registered-dex-event-discovery',enabledDexes:deployments.map(d=>d.id),registeredFactories:factoryToProtocol.size,v4PoolManager:deployments.find(d=>d.protocol==='uniswap-v4')?.poolManager}))}
 private async getLogs(abi:readonly unknown[],from:bigint,to:bigint):Promise<any[]>{try{return await this.client.getLogs({event:abi[0] as never,fromBlock:from,toBlock:to})}catch(e){if(from===to)throw e;const m=from+((to-from)/2n);const[a,b]=await Promise.all([this.getLogs(abi,from,m),this.getLogs(abi,m+1n,to)]);return[...a,...b]}}
 private async tokensFor(pool:`0x${string}`){const k=pool.toLowerCase(),c=this.poolTokens.get(k);if(c)return c;try{const[token0,token1]=await Promise.all([this.client.readContract({address:pool,abi:TOKEN_ABI,functionName:'token0'}),this.client.readContract({address:pool,abi:TOKEN_ABI,functionName:'token1'})]);const t={token0:token0 as `0x${string}`,token1:token1 as `0x${string}`};this.poolTokens.set(k,t);return t}catch{return undefined}}
 private async identify(pool:`0x${string}`){const k=pool.toLowerCase(),c=this.poolProtocols.get(k);if(c)return c;try{const f=await this.client.readContract({address:pool,abi:FACTORY_ABI,functionName:'factory'}) as `0x${string}`;const p=factoryToProtocol.get(f.toLowerCase());if(p)this.poolProtocols.set(k,p);return p}catch{return undefined}}
 private async normalize(abi:readonly unknown[],logs:any[],kind:EventProtocol){const out:NormalizedSwap[]=[];for(const log of logs){if(log.transactionHash===null||log.logIndex===undefined)continue;try{const pool=log.address as `0x${string}`;const protocol=await this.identify(pool);if(!protocol)continue;if(kind==='v2'&&!V2_PROTOCOLS.has(protocol))continue;if(kind==='v3'&&!V3_PROTOCOLS.has(protocol))continue;const tokens=await this.tokensFor(pool);if(!tokens)continue;const q0=isQuote(tokens.token0),q1=isQuote(tokens.token1);if(q0===q1)continue;const targetToken=(q0?tokens.token1:tokens.token0);const decoded=decodeEventLog({abi,topics:log.topics,data:log.data});const args=decoded.args as Record<string,unknown>;const trader=typeof args.sender==='string'&&/^0x[0-9a-fA-F]{40}$/.test(args.sender)?args.sender as `0x${string}`:undefined;const ev:Parameters<typeof normalizeSwapEvent>[0]={status:'decoded',address:pool,protocol,eventName:'Swap',args,transactionHash:log.transactionHash,logIndex:Number(log.logIndex)};const n=normalizeSwapEvent(ev,{address:pool,token0:tokens.token0,token1:tokens.token1,targetToken});if(n.status==='normalized')out.push(trader?{...n,trader}:n)}catch{}}
 return out}
 async poll(toBlock:bigint,maxRange=25n){await this.seedPools();if(this.lastBlock===undefined)this.lastBlock=toBlock>maxRange?toBlock-maxRange:0n;const from=this.lastBlock+1n;if(from>toBlock)return undefined;const to=from+maxRange-1n<toBlock?from+maxRange-1n:toBlock;const[v3Logs,v2Logs]=await Promise.all([this.getLogs(V3_SWAP,from,to),this.getLogs(V2_SWAP,from,to)]);const[v3,v2]=await Promise.all([this.normalize(V3_SWAP,v3Logs,'v3'),this.normalize(V2_SWAP,v2Logs,'v2')]);const swaps=[...v3,...v2].sort((a,b)=>a.logIndex-b.logIndex);this.lastBlock=to;if(swaps.length){this.recentSwaps=[...this.recentSwaps,...swaps].slice(-this.maxRecentSwaps);const dexCounts=swaps.reduce<Record<string,number>>((m,s)=>{const k=s.protocol??'unknown';m[k]=(m[k]??0)+1;return m},{});console.log(JSON.stringify({event:'swaps_ingested_batch',count:swaps.length,rawV3Logs:v3Logs.length,rawV2Logs:v2Logs.length,fromBlock:from.toString(),toBlock:to.toString(),dexCounts}))}return{swaps,fromBlock:from,toBlock:to}}
 getRecentSwaps(){return[...this.recentSwaps]}
 reset(){this.lastBlock=undefined;this.recentSwaps=[];this.poolTokens.clear();this.poolProtocols.clear();this.seeded=false}
 stop(){}}
