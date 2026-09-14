import fs from 'node:fs';
const path = new URL('../src/trading-runtime.ts', import.meta.url);
let s = fs.readFileSync(path, 'utf8');
s = s.replaceAll('args: [poolId]', 'args: [poolId as `0x${string}`]');
s = s.replaceAll('address: stateView,', 'address: stateView as `0x${string}`,');
fs.writeFileSync(path, s);
console.log(JSON.stringify({event:'v4_final_type_patch'}));
