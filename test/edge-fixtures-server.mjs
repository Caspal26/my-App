// Disposable workerd/D1 instance used by the same phone UI tests as Node.
import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import { extname,join } from 'node:path';
import { EdgeStore } from '../workers/store.mjs';
import { localClock } from '../src/time.mjs';
const publicRoot=new URL('../public/',import.meta.url).pathname;
const contentTypes={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
const mf=new Miniflare({
  modules:true,scriptPath:new URL('../var/worker-build/index.js',import.meta.url).pathname,
  compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],port:4173,host:'127.0.0.1',
  d1Databases:{DB:'browser-test-only'},
  bindings:{APP_PASSWORD:'browser-test-passphrase-only',APP_URL:'http://127.0.0.1:4173',VAPID_SUBJECT:'mailto:test@example.org'},
  serviceBindings:{ASSETS:async request=>{
    const path=new URL(request.url).pathname;
    if(path==='/index.html')return Response.redirect(new URL('/',request.url).href,308);
    if(path.includes('..'))return new Response('Not found',{status:404});
    const file=join(publicRoot,path==='/'?'index.html':path);
    try{return new Response(readFileSync(file),{headers:{'Content-Type':contentTypes[extname(file)]||'application/octet-stream'}});}
    catch{return new Response('Not found',{status:404});}
  }},
});
const db=await mf.getD1Database('DB');
const schema=readFileSync(new URL('../workers/migrations/0001_initial.sql',import.meta.url),'utf8');
await db.batch(schema.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
const store=new EdgeStore(db);await store.init();
const today=localClock(new Date(),'Africa/Nairobi').date;
for(let days=2;days>=0;days--){const date=new Date(`${today}T12:00:00Z`);date.setUTCDate(date.getUTCDate()-days);await store.publish(date.toISOString().slice(0,10));}
await mf.ready;
console.log('Disposable serverless browser fixture ready.');
async function stop(){await mf.dispose();process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
