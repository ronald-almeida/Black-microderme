import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import { GET as production } from '../api/index.js';
import { createCheckout } from '../lib/checkout.js';
import {MemoryStore,fakeGateway,testEnv} from '../tests/support.mjs';
const demo=process.argv.includes('--demo');
if(demo && process.env.VERCEL)throw new Error('Demo is local only.');
const gateway=fakeGateway(),store=new MemoryStore();
const handler=demo?createCheckout({env:testEnv,store,gateway}):production;
const publicPath=path.resolve('public');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.avif':'image/avif','.webp':'image/webp','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1:3000');
    if(demo&&url.pathname==='/_dev/paid'&&req.method==='POST'&&req.headers.origin==='http://127.0.0.1:3000'){gateway.paid=true;res.writeHead(200);res.end('OK');return;}
    if(demo&&url.pathname==='/_dev/demo.js'){res.setHeader('Content-Type','text/javascript');res.end(`const b=document.createElement('button');b.textContent='Simular pagamento (teste local)';b.style='position:fixed;bottom:12px;right:12px;padding:15px;background:#132e40;color:white;border:0;z-index:99999';b.onclick=async()=>{await fetch('/_dev/paid',{method:'POST'});b.textContent='Pagamento de teste confirmado';};document.body.append(b);`);return;}
    if(url.pathname.startsWith('/api/')){
      const body=[];for await(const chunk of req)body.push(chunk);
      const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(body)}:{})});
      const response=await handler(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    const routes={'/':'/index.html','/checkout':'/checkout.html','/obrigado':'/obrigado.html','/privacidade':'/privacidade.html'};
    const file=path.resolve(publicPath,'.'+(routes[url.pathname]||decodeURIComponent(url.pathname)));
    if(!file.startsWith(publicPath+path.sep)){res.writeHead(403);res.end();return;}
    let content=await readFile(file);if(demo&&file.endsWith('.html'))content=Buffer.from(content.toString().replace('</body>','<div style="position:fixed;top:0;left:0;background:#132e40;color:white;z-index:99999;padding:5px 10px;font:11px Arial">TESTE LOCAL · SEM COBRANÇA REAL</div><script src="/_dev/demo.js"></script></body>'));
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(content);
  }catch(error){res.writeHead(error.code==='ENOENT'?404:500);res.end('Página indisponível');console.error(error.message);}
});
server.listen(3000,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:3000${demo?' (TEST ONLY)':''}`));
