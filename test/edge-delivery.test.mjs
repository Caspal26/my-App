import { test,before,beforeEach,after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createECDH,randomBytes } from 'node:crypto';
import { Miniflare } from 'miniflare';
import ece from 'http_ece';
import { EdgeStore,defaultSettings } from '../workers/store.mjs';
import { configurePush,deliver,providerSend } from '../workers/delivery.mjs';

let mf,store,db;
before(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("delivery test")}}',compatibilityDate:'2026-07-01',d1Databases:{DB:'edge-delivery-tests'}});
  db=await mf.getD1Database('DB');store=new EdgeStore(db);
  const sql=readFileSync(new URL('../workers/migrations/0001_initial.sql',import.meta.url),'utf8');
  await db.batch(sql.split(';').map(v=>v.trim()).filter(Boolean).map(v=>db.prepare(v)));
});
beforeEach(async()=>{
  await db.batch(['reserve','editions','ledger','subscriptions','deliveries','jobs','sessions','meta','login_attempts'].map(table=>db.prepare(`DELETE FROM ${table}`)));
  await store.saveSettings({...defaultSettings});await store.init();
});
after(async()=>{await mf?.dispose();});

async function subscribe(name='one'){
  const endpoint='https://fcm.googleapis.com/fcm/send/'+name;
  const client=createECDH('prime256v1');client.generateKeys();const auth=randomBytes(16);
  const subscription={endpoint,keys:{p256dh:client.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}};
  await db.prepare('INSERT INTO subscriptions(endpoint,payload) VALUES(?,?)').bind(endpoint,JSON.stringify(subscription)).run();
  return {endpoint,subscription,client,auth};
}

test('edge push configuration persists one winning key pair across concurrent requests',async()=>{
  const keys=await Promise.all(Array.from({length:6},()=>configurePush(store,{})));
  assert.equal(new Set(keys).size,1);
  assert.match(keys[0],/^[A-Za-z0-9_-]{87}$/);
  const row=await db.prepare("SELECT value FROM meta WHERE key='vapid'").first();
  const persisted=JSON.parse(row.value);
  assert.equal(persisted.publicKey,keys[0]);assert.ok(persisted.privateKey);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM meta WHERE key='vapid'").first()).count,1);
});

test('concurrent edge cron deliveries claim once before I/O and preserve exactly one accepted send',async()=>{
  await subscribe();const edition=await store.publish('2026-11-01');let sends=0;
  const send=async()=>{
    sends++;
    assert.equal((await db.prepare('SELECT status FROM deliveries WHERE edition_id=?').bind(edition.id).first()).status,'sending');
    await new Promise(resolve=>setTimeout(resolve,30));
  };
  await Promise.all([deliver(store,edition,{send}),deliver(store,edition,{send})]);
  await deliver(store,edition,{send});
  assert.equal(sends,1);
  assert.deepEqual(await deliver(store,edition,{send}),[{channel:'push',status:'sent',attempts:1}]);
});

test('edge ambiguous provider failures are held, while explicit rate rejection is bounded at three attempts',async()=>{
  await subscribe();const first=await store.publish('2026-11-01');let ambiguous=0;
  const interrupted=async()=>{ambiguous++;throw new Error('connection closed after provider acceptance');};
  await deliver(store,first,{send:interrupted});await deliver(store,first,{send:interrupted});
  assert.equal(ambiguous,1);
  assert.equal((await db.prepare('SELECT status FROM deliveries WHERE edition_id=?').bind(first.id).first()).status,'uncertain');
  const next=await store.publish('2026-11-02');let limited=0;
  const rejected=async()=>{limited++;throw Object.assign(new Error('rate limited'),{statusCode:429});};
  for(let i=0;i<5;i++)await deliver(store,next,{send:rejected});
  assert.equal(limited,3);
  assert.deepEqual(await deliver(store,next,{send:rejected}),[{channel:'push',status:'failed',attempts:3}]);
});

test('edge opt-out and unsubscribe cancel outstanding rejected notifications',async()=>{
  const {endpoint}=await subscribe();const edition=await store.publish('2026-11-01');
  await store.saveSettings({...defaultSettings,whatsappEnabled:true,whatsappConsent:true,whatsappPhone:'+254700000000'});
  let sends=0;const rejected=async()=>{sends++;throw Object.assign(new Error('rate limited'),{statusCode:429});};
  await deliver(store,edition,{send:rejected});assert.equal(sends,2);
  await store.saveSettings({...defaultSettings});await db.prepare('DELETE FROM subscriptions WHERE endpoint=?').bind(endpoint).run();
  const states=await deliver(store,edition,{send:rejected});
  assert.equal(sends,2);assert.equal(states.length,2);assert.ok(states.every(s=>s.status==='cancelled'));
});

test('edge invocation recovery holds stale in-flight sends without cancelling a fresh request',async()=>{
  const old=await subscribe('old'),fresh=await subscribe('fresh'),edition=await store.publish('2026-11-01');
  for(const [target,time]of [[old.endpoint,new Date(Date.now()-6*60000).toISOString()],[fresh.endpoint,new Date().toISOString()]]){
    await db.prepare("INSERT INTO deliveries(id,edition_id,channel,target,status,attempts,error,updated_at) VALUES(?,?, 'push',?,'sending',1,NULL,?)").bind(crypto.randomUUID(),edition.id,target,time).run();
  }
  let sends=0;await deliver(store,edition,{send:async()=>{sends++;}});
  assert.equal(sends,0);
  assert.equal((await db.prepare('SELECT status FROM deliveries WHERE target=?').bind(old.endpoint).first()).status,'uncertain');
  assert.equal((await db.prepare('SELECT status FROM deliveries WHERE target=?').bind(fresh.endpoint).first()).status,'sending');
});

test('edge delivery without a public app URL fails definitively before any provider request',async()=>{
  await subscribe();const edition=await store.publish('2026-11-01');let requests=0;
  const result=await deliver(store,edition,{env:{},send:(...args)=>providerSend(...args,async()=>{requests++;throw Error('must not fetch');})});
  assert.deepEqual(result,[{channel:'push',status:'failed',attempts:1}]);assert.equal(requests,0);
});

test('edge Web Push uses fetch with real encryption, VAPID claims and an exact-edition notification payload',async()=>{
  const client=await subscribe(),edition=await store.publish('2026-11-01');let captured;
  const env={APP_URL:'https://morning.example',VAPID_SUBJECT:'mailto:owner@example.org'};
  await providerSend('push',client.endpoint,edition,store,env,async(endpoint,options)=>{
    captured={endpoint,options};return new Response(null,{status:201});
  });
  assert.equal(captured.endpoint,client.endpoint);assert.equal(captured.options.method,'POST');assert.equal(captured.options.redirect,'manual');
  const headers=new Headers(captured.options.headers);
  assert.equal(headers.get('content-encoding'),'aes128gcm');
  const token=headers.get('authorization').match(/\bt=([^, ]+)/)[1];
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
  assert.equal(claims.aud,'https://fcm.googleapis.com');assert.equal(claims.sub,env.VAPID_SUBJECT);
  const plain=ece.decrypt(Buffer.from(captured.options.body),{version:'aes128gcm',privateKey:client.client,authSecret:client.auth});
  const notification=JSON.parse(plain.toString());
  assert.equal(notification.title,edition.title);assert.equal(notification.editionId,edition.id);
  assert.equal(notification.url,env.APP_URL+'/?edition='+edition.id);
  assert.ok(!Buffer.from(captured.options.body).includes(Buffer.from(edition.title)),'provider body is encrypted');
});

test('edge WhatsApp uses the official approved-template contract and exact reading URL',async()=>{
  const edition=await store.publish('2026-11-01'),phone='+254700000000';
  await store.saveSettings({...defaultSettings,whatsappEnabled:true,whatsappConsent:true,whatsappPhone:phone});
  const env={APP_URL:'https://morning.example',WHATSAPP_TOKEN:'synthetic-test-token',WHATSAPP_PHONE_NUMBER_ID:'123456789',WHATSAPP_TEMPLATE_NAME:'daily_reading'};let captured;
  await providerSend('whatsapp',phone,edition,store,env,async(endpoint,options)=>{captured={endpoint,options};return new Response(null,{status:200});});
  assert.equal(captured.endpoint,'https://graph.facebook.com/v23.0/123456789/messages');
  const body=JSON.parse(captured.options.body);
  assert.equal(body.messaging_product,'whatsapp');assert.equal(body.type,'template');assert.equal(body.template.name,'daily_reading');assert.equal(body.to,phone);
  assert.deepEqual(body.template.components[0].parameters,[{type:'text',text:edition.title},{type:'text',text:'https://morning.example/?edition='+edition.id}]);
});
