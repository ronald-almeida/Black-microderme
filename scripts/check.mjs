import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('public');
const routes=new Set(['/checkout','/obrigado','/privacidade','/']);
let checked=0;
for(const file of await readdir(root)){
  if(!/\.(html|css)$/.test(file))continue;
  const text=await readFile(path.join(root,file),'utf8');
  if(file==='index.html'&&/797,00|82,43|12x de|pay\.hub\.la|googletagmanager|clarity\.ms|rocketlazyloadscript/i.test(text))throw new Error('Original price, checkout or tracking remains.');
  for(const match of text.matchAll(/(?:src|href)=["'](\/[^"'#?]+)|url\(["']?(\/[^\s)"']+)/g)){
    const url=match[1]||match[2];if(routes.has(url))continue;
    const full=path.join(root,url);if(!(await stat(full)).isFile())throw new Error('Missing asset '+url);checked++;
  }
}
await import('../api/index.js');
console.log(`Build OK: ${checked} asset references verified; server imports correctly.`);
