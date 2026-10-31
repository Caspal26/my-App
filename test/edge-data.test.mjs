import { test,before,after,beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as MiniflarePackage from 'miniflare';
import seeds from '../data/reserve.json' with {type:'json'};
import { EdgeStore } from '../workers/store.mjs';
import { runMorning } from '../workers/scheduler.mjs';

const schema=readFileSync(new URL('../workers/migrations/0001_initial.sql',import.meta.url),'utf8');
const tables=['settings','reserve','editions','ledger','subscriptions','deliveries','jobs','sessions','login_attempts','meta'];
let emulator,db,store;
before(async()=>{
  const options={modules:true,script:'export default {fetch(){return new Response("D1 test fixture")}}',compatibilityDate:'2025-09-01',d1Databases:['DB']};
  const convert=MiniflarePackage.convertV4MiniflareOptions??(value=>value);
  emulator=new MiniflarePackage.Miniflare(convert(options));
  db=await emulator.getD1Database('DB');
  await db.batch(schema.split(';').map(sql=>sql.trim()).filter(Boolean).map(sql=>db.prepare(sql)));
});
after(async()=>{await emulator?.dispose();});
beforeEach(async()=>{
  await db.batch(tables.map(table=>db.prepare(`DELETE FROM ${table}`)));
  store=new EdgeStore(db);
  await store.init();
});
async function subscribe() {
  const endpoint='https://fcm.googleapis.com/fcm/send/serverless-test';
  await db.prepare('INSERT INTO subscriptions(endpoint,payload) VALUES(?,?)').bind(endpoint,JSON.stringify({endpoint,keys:{p256dh:'fixture',auth:'fixture'}})).run();
}

test('D1 migration and seed import are repeatable without changing preferences or consumed history',async()=>{
  await store.saveSettings({...await store.settings(),deliveryTime:'07:30'});
  const original=await store.publish('2026-11-01');
  await db.batch(schema.split(';').map(sql=>sql.trim()).filter(Boolean).map(sql=>db.prepare(sql)));
  await new EdgeStore(db).init();
  assert.equal((await store.settings()).deliveryTime,'07:30');
  assert.deepEqual(await store.publish('2026-11-01'),original);
  assert.equal((await store.reserve()).length,seeds.length-1);
  assert.equal((await store.ledger()).length,1);
});

test('three serverless Nairobi mornings publish distinct sourced editions and retries send once',async()=>{
  await subscribe();
  const sent=[],editions=[];
  const send=async(channel,target,edition)=>sent.push({channel,target,id:edition.id,title:edition.title});
  for(const date of ['2026-11-01','2026-11-02','2026-11-03']) {
    await runMorning(store,{now:new Date(date+'T04:15:00Z'),send});
    assert.equal((await store.edition(date)).published,false);
    assert.equal((await store.archive()).some(e=>e.date===date),false);
    await runMorning(store,{now:new Date(date+'T05:00:00Z'),send});
    editions.push(await store.edition(date));
  }
  const original=structuredClone(editions[1]);
  await runMorning(new EdgeStore(db),{now:new Date('2026-11-02T05:01:00Z'),send});
  assert.deepEqual(await store.edition('2026-11-02'),original);
  assert.equal(sent.length,3);
  assert.equal(new Set(editions.map(e=>e.eventKey)).size,3);
  assert.equal(new Set(editions.map(e=>e.quote.text)).size,3);
  assert.equal((await store.ledger()).length,3);
  for(const edition of editions) {
    assert.ok(edition.sources.some(s=>s.kind==='story'));
    assert.ok(edition.sources.some(s=>s.kind==='quote'&&s.url===edition.quote.url));
    assert.equal((await store.byId(edition.id)).title,edition.title);
  }
});

test('simultaneous invocations allocate exactly one immutable edition per day',async()=>{
  const results=await Promise.all(Array.from({length:8},()=>new EdgeStore(db).publish('2026-11-01')));
  assert.equal(new Set(results.map(e=>e.id)).size,1);
  assert.equal((await store.ledger()).length,1);
  assert.equal((await store.reserve()).length,seeds.length-1);
  assert.deepEqual(await store.edition('2026-11-01'),results[0]);
});

test('concurrent allocation of different dates cannot consume one event or quote twice',async()=>{
  const results=await Promise.all(['01','02','03','04'].map(day=>new EdgeStore(db).publish(`2026-11-${day}`)));
  assert.equal(new Set(results.map(e=>e.eventKey)).size,4);
  assert.equal(new Set(results.map(e=>e.quote.text)).size,4);
  assert.equal((await store.ledger()).length,4);
  assert.equal((await store.reserve()).length,seeds.length-4);
});

test('consumed quotes and events stay excluded even if their old reserve rows are removed',async()=>{
  const edition=await store.publish('2026-11-01');
  await db.prepare('DELETE FROM reserve WHERE event_key=?').bind(edition.eventKey).run();
  assert.equal(await store.addReserve({...seeds[0],id:'new-key',eventKey:'new-incident-key'}),false,'published quote cannot be recycled with another key');
  assert.equal(await store.addReserve({...seeds[0],id:'another-key',quote:{...seeds[0].quote,text:'A genuinely different synthetic test quote.'}}),false,'published incident cannot be recycled with another quote');
  assert.equal((await store.ledger()).length,1);
});

test('near-midnight scheduling prepares the next local calendar date',async()=>{
  await store.saveSettings({...await store.settings(),deliveryTime:'00:05'});
  await store.publish('2026-11-01');
  await runMorning(store,{now:new Date('2026-11-01T20:30:00Z')});
  assert.equal((await store.edition('2026-11-02')).published,false);
  await runMorning(store,{now:new Date('2026-11-01T21:05:00Z')});
  assert.equal((await store.edition('2026-11-02')).published,true);
});

test('research claims survive isolate restarts, expire safely, and have a bounded retry budget',async()=>{
  const start=Date.parse('2026-11-01T04:15:00Z');
  const first=await store.claimResearch('2026-11-01',start);
  assert.equal(first.attempt,1);
  assert.equal(await new EdgeStore(db).claimResearch('2026-11-01',start+60_000),null);
  const second=await new EdgeStore(db).claimResearch('2026-11-01',start+11*60_000);
  assert.equal(second.attempt,2);
  await store.finishResearch(first,'complete','',start+11*60_000);
  assert.equal(await store.researchClaimCurrent(second),true,'a stale invocation cannot finish the replacement lease');
  await store.finishResearch(second,'failed','Synthetic provider outage',start+11*60_000);
  assert.equal(await store.claimResearch('2026-11-01',start+12*60_000),null,'provider failures are not hammered every minute');
  const third=await store.claimResearch('2026-11-01',start+16*60_000);
  assert.equal(third.attempt,3);
  await store.finishResearch(third,'failed','Synthetic provider outage',start+16*60_000);
  assert.equal(await store.claimResearch('2026-11-01',start+30*60_000),null);
});

test('overlapping cron invocations share a durable research lease and keep the researched reserve',async()=>{
  await runMorning(store,{now:new Date('2026-11-01T04:15:00Z')});
  let release,started;
  const barrier=new Promise(resolve=>{release=resolve;});
  const beginning=new Promise(resolve=>{started=resolve;});
  let calls=0;
  const research=async()=>{calls++;started();await barrier;throw new Error('Synthetic research outage');};
  const first=runMorning(store,{now:new Date('2026-11-01T04:16:00Z'),research});
  await beginning;
  await runMorning(new EdgeStore(db),{now:new Date('2026-11-01T04:16:00Z'),research});
  release();await first;
  assert.equal(calls,1);
  assert.equal((await store.edition('2026-11-01')).published,false);
  await runMorning(store,{now:new Date('2026-11-01T05:00:00Z')});
  assert.equal((await store.edition('2026-11-01')).published,true);
});

test('an exhausted serverless reserve records failure without recycling earlier stories',async()=>{
  for(let i=1;i<=seeds.length;i++)await store.publish(`2026-11-${String(i).padStart(2,'0')}`);
  const date=`2026-11-${String(seeds.length+1).padStart(2,'0')}`;
  const result=await runMorning(store,{now:new Date(date+'T05:00:00Z')});
  assert.equal(await store.edition(date),null);
  assert.equal((await store.archive()).length,seeds.length);
  assert.match(result[0].error,/reserve is empty/);
  assert.equal((await db.prepare('SELECT status FROM jobs WHERE id=?').bind('morning:'+date).first()).status,'failed');
});
