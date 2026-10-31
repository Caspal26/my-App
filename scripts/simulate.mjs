import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { Scheduler } from '../src/scheduler.mjs';

const dir=mkdtempSync(join(tmpdir(),'founders-morning-simulation-'));
const store=new Store(join(dir,'simulation.sqlite'));
const notifications=[];
const endpoint='https://fcm.googleapis.com/fcm/send/simulated-device';
store.db.prepare('INSERT INTO subscriptions VALUES(?,?)').run(endpoint,JSON.stringify({endpoint,keys:{p256dh:'simulated',auth:'simulated'}}));
const scheduler=new Scheduler(store,{send:async(channel,target,edition)=>{
  notifications.push({channel,title:edition.title,editionId:edition.id,url:'/?edition='+edition.id});
}});
try{
  const editions=[];
  for(const date of ['2026-11-01','2026-11-02','2026-11-03']){
    await scheduler.run(new Date(date+'T04:15:00Z'));
    assert.equal(store.edition(date).published,false);
    await scheduler.run(new Date(date+'T05:00:00Z'));
    editions.push(store.edition(date));
  }
  const before=structuredClone(editions[1]);
  await scheduler.run(new Date('2026-11-02T05:01:00Z'));
  assert.deepEqual(store.edition('2026-11-02'),before);
  assert.equal(notifications.length,3);
  assert.equal(new Set(editions.map(e=>e.eventKey)).size,3);
  assert.equal(new Set(editions.map(e=>e.quote.text)).size,3);
  for(const notification of notifications){
    const id=new URL(notification.url,'https://test.invalid').searchParams.get('edition');
    assert.equal(store.byId(id).title,notification.title);
  }
  const report={generatedAt:new Date().toISOString(),mode:'Simulated clock and delivery transport; real researched reserve; no live phone or AI-provider claim',timezone:'Africa/Nairobi',deliveryTime:'08:00',retry:{date:'2026-11-02',originalPreserved:true,notificationsAfterRetry:3},permanentLedgerEntries:store.ledger().length,editions:editions.map(e=>({id:e.id,date:e.date,title:e.title,founder:e.founder,company:e.company,event:e.event,eventDate:e.eventDate,eventKey:e.eventKey,quote:e.quote,sources:e.sources.map(s=>({url:s.url,title:s.title,kind:s.kind,retrievedAt:s.retrievedAt})),researchedAt:e.researchedAt})),notifications};
  mkdirSync(new URL('../docs/',import.meta.url),{recursive:true});
  writeFileSync(new URL('../docs/simulation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  const readings=editions.map(e=>{
    const quoteAfter=e.quoteAfterParagraph||Math.max(1,e.paragraphs.length-3);
    const quote=`> ${e.quote.text}\n>\n> — ${e.quote.author}, *${e.quote.work}*, ${e.quote.section}`;
    const body=e.paragraphs.map((p,i)=>p+(i+1===quoteAfter?'\n\n'+quote:'')).join('\n\n');
    return `## ${e.date} — ${e.title}\n\n${e.founder} · ${e.company} · ${e.readingMinutes}-minute read\n\n${body}\n\n**One small invitation:** ${e.invitation}\n\nSources (researched ${e.researchedAt.slice(0,10)}):\n\n${e.sources.map(s=>`- [${s.title}](${s.url}) — ${s.kind}`).join('\n')}`;
  }).join('\n\n---\n\n');
  writeFileSync(new URL('../docs/THREE-MORNINGS.md',import.meta.url),`# Three simulated mornings\n\nGenerated ${report.generatedAt}. These use a simulated clock and push transport with the real researched reserve. Daily time: 08:00 Africa/Nairobi; research/preparation: 07:15.\n\nAll three event keys and quotes are distinct. Retrying 2 November preserves the complete original edition; total simulated sends stay at three. Every notification URL resolves to its exact original edition. Machine-readable evidence: [simulation.json](simulation.json). Offline reload and actual service-worker notification handling are checked separately by four passing browser tests. Real Android push reception, public HTTPS hosting and paid live research have not been verified.\n\n${readings}\n`);
  for(const e of report.editions){
    console.log(`${e.date} — ${e.title} (${e.founder}, ${e.company})`);
    console.log(`  “${e.quote.text}” — ${e.quote.author}, ${e.quote.work}, ${e.quote.section}`);
    for(const source of e.sources)console.log(`  ${source.kind}: ${source.url}`);
  }
  console.log('PASS: three distinct sourced stories and quotes; retry preserves original edition; exactly three simulated notifications; every link resolves to its exact edition.');
  console.log('Evidence saved to docs/simulation.json. Browser/offline checks are separate.');
}finally{store.close();rmSync(dir,{recursive:true,force:true});}
