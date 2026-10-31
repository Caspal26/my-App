import webpush from 'web-push';
import { randomUUID } from 'node:crypto';

export function configurePush(store) {
  let saved=store.db.prepare("SELECT value FROM meta WHERE key='vapid'").get();
  const keys=saved?JSON.parse(saved.value):webpush.generateVAPIDKeys();
  if(!saved)store.db.prepare('INSERT INTO meta VALUES(?,?)').run('vapid',JSON.stringify(keys));
  webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@example.com',keys.publicKey,keys.privateKey);
  return keys.publicKey;
}

export async function providerSend(channel,target,edition,store) {
  const url=new URL('/?edition='+encodeURIComponent(edition.id),process.env.APP_URL||process.env.RENDER_EXTERNAL_URL||'http://localhost:3000').href;
  if(channel==='push') {
    const row=store.db.prepare('SELECT payload FROM subscriptions WHERE endpoint=?').get(target);
    if(!row)return;
    await webpush.sendNotification(JSON.parse(row.payload),JSON.stringify({title:edition.title,body:'Your morning reading is ready. Take a quiet moment.',url,editionId:edition.id}),{TTL:86400,timeout:15000,topic:edition.id.replace(/-/g,'').slice(0,32)});
  }else{
    const required=['WHATSAPP_TOKEN','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_TEMPLATE_NAME'];
    if(required.some(k=>!process.env[k]))throw new Error('WhatsApp provider is not configured');
    const version=process.env.WHATSAPP_GRAPH_VERSION||'v23.0';
    const response=await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{
      method:'POST',headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),
      body:JSON.stringify({messaging_product:'whatsapp',to:target,type:'template',template:{name:process.env.WHATSAPP_TEMPLATE_NAME,language:{code:process.env.WHATSAPP_TEMPLATE_LANGUAGE||'en'},components:[{type:'body',parameters:[{type:'text',text:edition.title},{type:'text',text:url}]}]}})
    });
    if(!response.ok){const e=new Error(`WhatsApp returned HTTP ${response.status}`);e.statusCode=response.status;throw e;}
  }
}

// Persist before provider I/O. An ambiguous network failure is held for review rather than risking a duplicate.
export async function deliver(store,edition,send=providerSend) {
  const settings=store.settings();
  const targets=store.db.prepare('SELECT endpoint FROM subscriptions').all().map(r=>['push',r.endpoint]);
  if(settings.whatsappEnabled&&settings.whatsappConsent)targets.push(['whatsapp',settings.whatsappPhone]);
  for(const [channel,target]of targets)store.db.prepare("INSERT OR IGNORE INTO deliveries VALUES(?,?,?,?, 'pending',0,NULL,?)").run(randomUUID(),edition.id,channel,target,new Date().toISOString());
  const pending=store.db.prepare("SELECT * FROM deliveries WHERE edition_id=? AND status='pending'").all(edition.id);
  for(const row of pending){
    if(!targets.some(([channel,target])=>channel===row.channel&&target===row.target)){
      store.db.prepare("UPDATE deliveries SET status='cancelled',updated_at=? WHERE id=? AND status='pending'").run(new Date().toISOString(),row.id);
      continue;
    }
    const claimed=store.db.prepare("UPDATE deliveries SET status='sending',attempts=attempts+1,updated_at=? WHERE id=? AND status='pending'").run(new Date().toISOString(),row.id).changes;
    if(!claimed)continue;
    try{
      await send(row.channel,row.target,edition,store);
      store.db.prepare("UPDATE deliveries SET status='sent',updated_at=? WHERE id=?").run(new Date().toISOString(),row.id);
    }catch(e){
      const status=e.statusCode;
      const gone=row.channel==='push'&&(status===404||status===410);
      // 429 explicitly rejects acceptance. It is safe to retry, up to three times, on a later scheduler tick.
      const state=gone?'expired':status===429&&row.attempts<2?'pending':status>=400&&status<500?'failed':'uncertain';
      store.db.prepare('UPDATE deliveries SET status=?,error=?,updated_at=? WHERE id=?').run(state,`Provider ${status||'network'} failure`,new Date().toISOString(),row.id);
      if(gone)store.db.prepare('DELETE FROM subscriptions WHERE endpoint=?').run(row.target);
    }
  }
  return store.db.prepare('SELECT channel,status,attempts FROM deliveries WHERE edition_id=?').all(edition.id);
}
