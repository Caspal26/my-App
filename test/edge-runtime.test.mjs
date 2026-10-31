import { test,before,beforeEach,after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createECDH,randomBytes } from 'node:crypto';
import ece from 'http_ece';
import { Miniflare,createFetchMock } from 'miniflare';
import { EdgeStore } from '../workers/store.mjs';

let mf,db,store,fetchMock;
const notifications=[];
const origin='https://morning.example';
before(async()=>{
  execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--outdir','var/worker-test-build'],{cwd:new URL('../',import.meta.url).pathname,stdio:'pipe',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  fetchMock=createFetchMock();fetchMock.disableNetConnect();
  fetchMock.get('https://fcm.googleapis.com').intercept({path:'/fcm/send/runtime-test',method:'POST'}).reply(201,options=>{notifications.push(options);return '';}).persist();
  mf=new Miniflare({modules:true,scriptPath:new URL('../var/worker-test-build/index.js',import.meta.url).pathname,compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'runtime-test-only'},fetchMock,
    bindings:{APP_PASSWORD:'runtime-test-passphrase-only',APP_URL:origin,VAPID_SUBJECT:'mailto:test@example.org'},
    serviceBindings:{ASSETS:async()=>new Response('Public app shell',{headers:{'Content-Type':'text/html'}})},
  });
  db=await mf.getD1Database('DB');store=new EdgeStore(db);
  const schema=readFileSync(new URL('../workers/migrations/0001_initial.sql',import.meta.url),'utf8');
  await db.batch(schema.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
});
beforeEach(async()=>{
  await db.batch(['settings','reserve','editions','ledger','subscriptions','deliveries','jobs','sessions','login_attempts','meta'].map(t=>db.prepare(`DELETE FROM ${t}`)));
  await store.init();notifications.length=0;
});
after(async()=>{await mf?.dispose();});
const request=(path,options={})=>mf.dispatchFetch(origin+path,options);
const post=(path,body,headers={})=>request(path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
async function login(){const r=await post('/api/login',{password:'runtime-test-passphrase-only'});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly.*SameSite=Strict.*Secure/);return r.headers.get('set-cookie').split(';')[0];}

test('the actual Worker protects private readings and returns public assets with security headers',async()=>{
  const shell=await request('/');assert.equal(shell.status,200);assert.equal(shell.headers.get('x-frame-options'),'DENY');
  assert.match(shell.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const privateResponse=await request('/api/editions');assert.equal(privateResponse.status,401);assert.equal(privateResponse.headers.get('cache-control'),'no-store');
  const session=await(await request('/api/session')).json();assert.deepEqual(session,{authenticated:false,needsSetup:false});
  const cookie=await login();
  const key=await(await request('/api/push/key',{headers:{Cookie:cookie}})).json();assert.match(key.publicKey,/^[A-Za-z0-9_-]{87}$/);assert.equal(key.privateKey,undefined);
  const badOrigin=await post('/api/logout',{}, {Cookie:cookie,Origin:'https://untrusted.example'});assert.equal(badOrigin.status,403);
  assert.equal((await post('/api/logout',{}, {Cookie:cookie})).status,200);
  assert.equal((await request('/api/editions',{headers:{Cookie:cookie}})).status,401);
});

test('Worker login rate limits persist in D1 between requests',async()=>{
  for(let i=0;i<8;i++)assert.equal((await post('/api/login',{password:'incorrect'})).status,401);
  assert.equal((await post('/api/login',{password:'runtime-test-passphrase-only'})).status,429);
  assert.equal((await db.prepare('SELECT count FROM login_attempts').first()).count,8);
});

test('scheduled Worker invocations publish three distinct mornings and encrypt one exact-edition push per day',async()=>{
  const client=createECDH('prime256v1');client.generateKeys();
  const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/runtime-test',keys:{p256dh:client.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
  const cookie=await login();
  assert.equal((await request('/api/push/key',{headers:{Cookie:cookie}})).status,200);
  assert.equal((await post('/api/push/subscribe',subscription,{Cookie:cookie})).status,200);
  const worker=await mf.getWorker(),editions=[];
  for(const day of ['2026-11-01','2026-11-02','2026-11-03']){
    await worker.scheduled({scheduledTime:Date.parse(day+'T04:15:00Z'),cron:'* * * * *'});
    assert.equal((await store.edition(day)).published,false);
    await worker.scheduled({scheduledTime:Date.parse(day+'T05:00:00Z'),cron:'* * * * *'});
    editions.push(await store.edition(day));
  }
  const original=structuredClone(editions[1]);
  await worker.scheduled({scheduledTime:Date.parse('2026-11-02T05:01:00Z'),cron:'* * * * *'});
  assert.deepEqual(await store.edition('2026-11-02'),original);
  assert.equal(new Set(editions.map(e=>e.eventKey)).size,3);assert.equal(new Set(editions.map(e=>e.quote.text)).size,3);
  assert.equal(notifications.length,3,JSON.stringify((await db.prepare('SELECT channel,status,error,attempts FROM deliveries').all()).results));
  for(const edition of editions){
    const row=await db.prepare('SELECT status,attempts FROM deliveries WHERE edition_id=?').bind(edition.id).first();assert.deepEqual(row,{status:'sent',attempts:1});
    const response=await request('/api/editions/'+edition.id,{headers:{Cookie:cookie}});assert.equal(response.status,200);assert.equal((await response.json()).title,edition.title);
  }
  for(const [index,notification] of notifications.entries()){
    const encrypted=Buffer.from(await new Response(notification.body).arrayBuffer());
    assert.ok(encrypted.length>100,'workerd produced an encrypted body');
    const payload=JSON.parse(ece.decrypt(encrypted,{version:'aes128gcm',privateKey:client,authSecret:Buffer.from(subscription.keys.auth,'base64url')}).toString());
    assert.equal(payload.title,editions[index].title);
    assert.equal(payload.url,origin+'/?edition='+editions[index].id);
  }
});
