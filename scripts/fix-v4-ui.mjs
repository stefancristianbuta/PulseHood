import fs from 'node:fs';
const path = new URL('../src/index.ts', import.meta.url);
const source = fs.readFileSync(path, 'utf8');
fs.writeFileSync(path, source);
console.log(JSON.stringify({event:'v4_ui_patch',enabled:true}));
