import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import webpush from 'web-push';
import { Store } from '../src/store.mjs';
import { Scheduler } from '../src/scheduler.mjs';
import { deliver, providerSend } from '../src/delivery.mjs';
import { createApp } from '../src/server.mjs';
import { localClock } from '../src/time.mjs';

const seeds = JSON.parse(readFileSync(new URL('../data/reserve.json', import.meta.url), 'utf8'));
const normalize = text => text.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
function storeFor(t) {
  const dir = mkdtempSync(join(tmpdir(), 'founders-morning-test-'));
  const store = new Store(join(dir, 'test.sqlite'));
  t.after(() => { store.close(); rmSync(dir, {recursive:true, force:true}); });
  return store;
}
function subscribe(store) {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/test-only';
  store.db.prepare('INSERT INTO subscriptions VALUES(?,?)').run(endpoint, JSON.stringify({endpoint, keys:{p256dh:'test',auth:'test'}}));
  return endpoint;
}

test('the researched reserve contains distinct sourced events and exact retained quotes', () => {
  assert.ok(seeds.length >= 3, 'three real editions are required for morning validation');
  assert.equal(new Set(seeds.map(e => e.eventKey)).size, seeds.length);
  assert.equal(new Set(seeds.map(e => normalize(e.quote.text))).size, seeds.length);
  for (const seed of seeds) {
    assert.ok(seed.founder && seed.company && seed.event && seed.eventDate && seed.researchedAt);
    assert.ok(seed.sources.some(s => s.kind === 'story' && s.excerpt?.length > 40));
    const source = seed.sources.find(s => s.kind === 'quote' && s.url === seed.quote.url);
    assert.ok(source, `quote source exists for ${seed.title}`);
    assert.ok(normalize(source.excerpt).includes(normalize(seed.quote.text)), `retained source contains exact quote: ${seed.title}`);
    assert.ok(seed.paragraphs.join(' ').split(/\s+/).length >= 300, 'a full short reading is present');
  }
});

test('three consecutive Nairobi mornings publish different editions; retry is immutable and sends once', async t => {
  const store = storeFor(t), calls = [];
  subscribe(store);
  const scheduler = new Scheduler(store, {send:async(channel,target,edition) => calls.push({channel,target,id:edition.id})});
  const editions = [];
  assert.equal(store.settings().deliveryTime, '08:00');
  assert.equal(store.settings().timezone, 'Africa/Nairobi');
  for (const date of ['2026-11-01','2026-11-02','2026-11-03']) {
    await scheduler.run(new Date(date+'T04:15:00Z'));
    assert.equal(store.edition(date).published, false, 'prepared 45 minutes before delivery');
    assert.equal(store.archive().some(e => e.date === date), false, 'prepared reading remains unpublished');
    await scheduler.run(new Date(date+'T05:00:00Z'));
    editions.push(store.edition(date));
  }
  const original = structuredClone(editions[1]);
  await scheduler.run(new Date('2026-11-02T05:01:00Z'));
  assert.deepEqual(store.edition('2026-11-02'), original);
  assert.equal(calls.length,3);
  assert.equal(new Set(editions.map(e => e.id)).size,3);
  assert.equal(new Set(editions.map(e => e.eventKey)).size,3);
  assert.equal(new Set(editions.map(e => e.quote.text)).size,3);
  assert.equal(store.ledger().length,3);
  assert.equal(store.archive().length,3);
  assert.equal(store.reserve().length,seeds.length-3);
  assert.equal(store.addReserve(seeds.find(s => s.eventKey === editions[0].eventKey)),false,'ledger prevents reseeding used episode');
});

test('publication, consumed reserve and uncertain send protection survive a process restart', async t => {
  const dir=mkdtempSync(join(tmpdir(),'founders-morning-restart-')),path=join(dir,'restart.sqlite');
  let store=new Store(path);
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  subscribe(store);
  const original=store.publish('2026-11-01');
  store.db.prepare("INSERT INTO deliveries VALUES(?,?,?,?, 'sending',1,NULL,?)").run('crash-test',original.id,'push','https://fcm.googleapis.com/fcm/send/test-only',new Date().toISOString());
  store.close();store=new Store(path);
  assert.deepEqual(store.publish('2026-11-01'),original);
  assert.equal(store.ledger().length,1);
  assert.equal(store.reserve().length,seeds.length-1);
  let sends=0;
  await deliver(store,original,async()=>{sends++;});
  assert.equal(sends,0,'a request interrupted by restart is not sent twice');
  assert.equal(store.db.prepare('SELECT status FROM deliveries WHERE id=?').get('crash-test').status,'uncertain');
});

test('a near-midnight delivery prepares tomorrow using the configured local calendar', async t => {
  const store = storeFor(t);
  store.saveSettings({...store.settings(),deliveryTime:'00:05'});
  store.publish('2026-11-01');
  const scheduler = new Scheduler(store, {send:async()=>{}});
  await scheduler.run(new Date('2026-11-01T20:30:00Z'));
  assert.equal(store.edition('2026-11-02').published,false);
  await scheduler.run(new Date('2026-11-01T21:05:00Z'));
  assert.equal(store.edition('2026-11-02').published,true);
  assert.equal(localClock(new Date('2026-11-01T21:05:00Z'),'Africa/Nairobi').date,'2026-11-02');
});

test('reserve exhaustion never republishes a used story', async t => {
  const store = storeFor(t), scheduler = new Scheduler(store);
  for(let day=1;day<=seeds.length;day++) store.publish(`2026-11-${String(day).padStart(2,'0')}`);
  const next=`2026-11-${String(seeds.length+1).padStart(2,'0')}`;
  await scheduler.run(new Date(next+'T05:00:00Z'));
  assert.equal(store.edition(next),null);
  assert.equal(store.archive().length,seeds.length);
  assert.equal(store.db.prepare('SELECT status FROM jobs WHERE id=?').get('morning:'+next).status,'failed');
});

test('research outage falls back to researched reserve and records the failure', async t => {
  const store=storeFor(t);let requests=0;
  store.db.exec('DELETE FROM reserve WHERE rowid NOT IN (SELECT rowid FROM reserve ORDER BY rowid LIMIT 3)');
  const scheduler=new Scheduler(store,{research:async({ledger,reserveEvents})=>{
    requests++;assert.ok(Array.isArray(ledger));assert.ok(reserveEvents.length>0);
    throw new Error('Simulated research outage');
  }});
  await scheduler.run(new Date('2026-11-01T04:15:00Z'));
  await scheduler.run(new Date('2026-11-01T05:00:00Z'));
  assert.equal(requests,1,'failed research is not hammered on each scheduler tick');
  assert.equal(store.edition('2026-11-01').published,true);
  assert.equal(store.db.prepare('SELECT status FROM jobs WHERE id=?').get('research:2026-11-01').status,'failed');
  assert.equal(store.edition('2026-11-01').eventKey,seeds[0].eventKey);
});

test('ambiguous provider errors are held and not duplicated; explicit rejections retry only three times', async t => {
  const store=storeFor(t); subscribe(store);
  const first=store.publish('2026-11-01');
  let uncertainCalls=0;
  const uncertain=async()=>{uncertainCalls++;throw new Error('connection closed after send');};
  await deliver(store,first,uncertain); await deliver(store,first,uncertain);
  assert.equal(uncertainCalls,1);
  assert.equal(store.db.prepare('SELECT status FROM deliveries WHERE edition_id=?').get(first.id).status,'uncertain');
  const second=store.publish('2026-11-02');let rateCalls=0;
  const limited=async()=>{rateCalls++;throw Object.assign(new Error('rate limited'),{statusCode:429});};
  for(let i=0;i<5;i++) await deliver(store,second,limited);
  assert.equal(rateCalls,3);
  assert.equal(store.db.prepare('SELECT status FROM deliveries WHERE edition_id=?').get(second.id).status,'failed');
});

test('WhatsApp opt-out cancels an outstanding explicitly rejected delivery', async t => {
  const store=storeFor(t),edition=store.publish('2026-11-01');
  store.saveSettings({...store.settings(),whatsappEnabled:true,whatsappConsent:true,whatsappPhone:'+254700000000'});
  let calls=0;
  const send=async()=>{calls++;throw Object.assign(new Error('rate limit'),{statusCode:429});};
  await deliver(store,edition,send);
  store.saveSettings({...store.settings(),whatsappEnabled:false,whatsappConsent:false});
  await deliver(store,edition,send);
  assert.equal(calls,1,'no queued message is sent after consent is withdrawn');
});

test('push payload carries the title and exact edition link, not a moving today link', async t => {
  const store=storeFor(t), endpoint=subscribe(store),edition=store.publish('2026-11-01');
  const original=webpush.sendNotification;let payload;
  webpush.sendNotification=async(subscription,body)=>{assert.equal(subscription.endpoint,endpoint);payload=JSON.parse(body);};
  t.after(()=>{webpush.sendNotification=original;});
  await providerSend('push',endpoint,edition,store);
  assert.equal(payload.title,edition.title);
  assert.equal(payload.editionId,edition.id);
  assert.equal(new URL(payload.url).searchParams.get('edition'),edition.id);
});

test('private API authenticates, returns the exact archived edition, validates settings, and revokes logout', async t => {
  const store=storeFor(t), first=store.publish('2026-11-01');
  store.publish('2026-11-02');
  const {app}=createApp({store,password:'private-test-password-123'});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,options={})=>fetch(base+path,options);
  assert.equal((await request('/api/editions')).status,401);
  const post=(path,body,headers={})=>request(path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await post('/api/login',{password:'wrong'})).status,401);
  const signed=await post('/api/login',{password:'private-test-password-123'});
  assert.equal(signed.status,200);
  const cookie=signed.headers.get('set-cookie').split(';')[0];
  const headers={Cookie:cookie};
  const response=await request('/api/editions/'+first.id,{headers});
  assert.equal(response.status,200);assert.equal((await response.json()).title,first.title);
  assert.equal((await request('/api/editions/not-an-edition',{headers})).status,404);
  assert.equal((await request('/api/settings',{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({deliveryTime:'25:70'})})).status,400);
  const update=await request('/api/settings',{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({deliveryTime:'07:30',timezone:'Africa/Nairobi'})});
  assert.equal(update.status,200);assert.equal((await update.json()).deliveryTime,'07:30');
  const before=store.archive();
  const encouragement=await post('/api/encouragement',{},headers);
  assert.equal(encouragement.status,200);assert.ok((await encouragement.json()).invitation);
  assert.deepEqual(store.archive(),before,'encouragement leaves daily history intact');
  assert.equal((await post('/api/logout',{},headers)).status,200);
  assert.equal((await request('/api/editions',{headers})).status,401);
});
