import fs from 'node:fs';

const path = new URL('../src/index.ts', import.meta.url);
let s = fs.readFileSync(path, 'utf8');

s = s.replace(
"const ERC20_SYMBOL = [{ type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }] as const;",
"const ERC20_SYMBOL = [{ type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }, { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }] as const;"
);

s = s.replace(
"const symbolCache=new Map<string,string>();\nconst symbolRetryAt=new Map<string,number>();\nconst SYMBOL_RETRY_MS=30_000;",
"const symbolCache=new Map<string,string>();\nconst nameCache=new Map<string,string>();\nconst symbolRetryAt=new Map<string,number>();\nconst SYMBOL_RETRY_MS=30_000;\nconst fallbackTokenLabel=(address:string)=>address.length>14?`${address.slice(0,8)}…${address.slice(-6)}`:address;"
);

const old = `async function tokenSymbol(address:string):Promise<string>{\n  const key=address.toLowerCase();\n  const cached=symbolCache.get(key);\n  if(cached) return cached;\n  const retryAt=symbolRetryAt.get(key)??0;\n  if(Date.now()<retryAt) return 'TOKEN';\n  symbolRetryAt.set(key,Date.now()+SYMBOL_RETRY_MS);\n  try{\n    const symbol=await rpc.getClient().readContract({address:address as \`0x\${string}\`,abi:ERC20_SYMBOL,functionName:'symbol'}) as string;\n    const clean=String(symbol??'').trim();\n    if(clean){symbolCache.set(key,clean);symbolRetryAt.delete(key);return clean;}\n  }catch{}\n  return 'TOKEN';\n}`;

const replacement = `async function tokenSymbol(address:string):Promise<string>{\n  const key=address.toLowerCase();\n  const cached=symbolCache.get(key);\n  if(cached) return cached;\n  const retryAt=symbolRetryAt.get(key)??0;\n  if(Date.now()<retryAt) return fallbackTokenLabel(address);\n  symbolRetryAt.set(key,Date.now()+SYMBOL_RETRY_MS);\n  try{\n    const client=rpc.getClient();\n    const [symbolResult,nameResult]=await Promise.allSettled([\n      client.readContract({address:key as \`0x\${string}\`,abi:ERC20_SYMBOL,functionName:'symbol'}),\n      client.readContract({address:key as \`0x\${string}\`,abi:ERC20_SYMBOL,functionName:'name'})\n    ]);\n    const symbol=symbolResult.status==='fulfilled'?String(symbolResult.value??'').trim():'';\n    const name=nameResult.status==='fulfilled'?String(nameResult.value??'').trim():'';\n    if(symbol){symbolCache.set(key,symbol);if(name)nameCache.set(key,name);symbolRetryAt.delete(key);return symbol;}\n    if(name) nameCache.set(key,name);\n  }catch{}\n  return fallbackTokenLabel(address);\n}`;

if(s.includes(old)) s=s.replace(old,replacement);

s=s.replace("symbol:symbolCache.get(x.token.toLowerCase())??'TOKEN'", "symbol:symbolCache.get(x.token.toLowerCase())??fallbackTokenLabel(x.token),tokenName:nameCache.get(x.token.toLowerCase())??null");
s=s.replace("symbol: s.symbol&&String(s.symbol)!==token.slice(0,8)?s.symbol:await tokenSymbol(token)", "symbol: s.symbol&&String(s.symbol)!==token.slice(0,8)&&String(s.symbol)!=='TOKEN'?s.symbol:await tokenSymbol(token)");
s=s.replace("symbol:state.candidates.get(x.token.toLowerCase())?.protocol??'DEX'", "symbol:state.candidates.get(x.token.toLowerCase())?.protocol??'DEX'");

fs.writeFileSync(path, s);
console.log(JSON.stringify({event:'token_label_patch',tokenFallback:'contract-address',nameLookup:true,tokenPlaceholderRemoved:!s.includes("return 'TOKEN'"),source:'src/index.ts'}));
