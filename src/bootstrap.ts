import { loadConfig } from './config.js';
import { RadarIngest } from './radar-ingest.js';
import { RpcManager } from './rpc.js';
import { TelemetryBus } from './telemetry.js';
import { FixedPaperTradingRuntime } from './trading-runtime-fixed.js';

await import('./index.js');
const config=loadConfig();
const telemetry=new TelemetryBus();
const rpc=new RpcManager(config.rpcUrls,telemetry,config.maxRpcLatencyMs,config.maxBlockLag);

async function start():Promise<void>{
 for(;;){
  try{
   await rpc.probe();
   const client=rpc.getClient();
   if(await client.getChainId()!==config.chainId)throw new Error('RPC chain mismatch');
   const ingest=new RadarIngest(client);
   const runtime=new FixedPaperTradingRuntime(client,telemetry,ingest);
   runtime.start();
   console.log(JSON.stringify({event:'paper_runtime_ready',chainId:config.chainId,mode:'paper'}));
   return;
  }catch(error){
   console.warn(JSON.stringify({event:'paper_runtime_waiting_for_rpc',message:error instanceof Error?error.message:String(error)}));
   await new Promise(r=>setTimeout(r,5000));
  }
 }
}
await start();
