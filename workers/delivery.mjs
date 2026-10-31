import webpush from 'web-push';

const PUSH_HOSTS=new Set(['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com']);
const changes=result=>Number(result?.meta?.changes??result?.changes??0);
const nowISO=()=>new Date().toISOString();

function configurationError(message){return Object.assign(new Error(message),{code:'DELIVERY_CONFIGURATION',definitive:true});}
function readingURL(env,edition){
  if(!env.APP_URL)throw configurationError('APP_URL must identify the public HTTPS app before notifications can be delivered');
  let base;try{base=new URL(env.APP_URL);}catch{throw configurationError('APP_URL is invalid');}
  const local=['localhost','127.0.0.1','[::1]'].includes(base.hostname);
  if(base.username||base.password||(base.protocol!=='https:'&&!(local&&base.protocol==='http:')))throw configurationError('APP_URL must use HTTPS');
  return new URL('/?edition='+encodeURIComponent(edition.id),base.origin).href;
}
function pushEndpoint(endpoint){
  let url;try{url=new URL(endpoint);}catch{throw configurationError('Invalid push endpoint');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||!PUSH_HOSTS.has(url.hostname))throw configurationError('Unsupported push endpoint');
  return url.href;
}

/** Keys are generated once, retained in D1, and never placed in browser assets. */
export async function configurePush(store,_env={}){
  let saved=await store.db.prepare("SELECT value FROM meta WHERE key='vapid'").first();
  if(!saved){
    const generated=webpush.generateVAPIDKeys();
    await store.db.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES(?,?)').bind('vapid',JSON.stringify(generated)).run();
    // A simultaneous request may have won INSERT OR IGNORE; everyone must use its keys.
    saved=await store.db.prepare("SELECT value FROM meta WHERE key='vapid'").first();
  }
  if(!saved)throw configurationError('Push keys could not be persisted');
  return JSON.parse(saved.value).publicKey;
}

/** Only Web Push signing/encryption uses the Node-compatible library. Transport
 * uses Worker fetch, so it does not need a resident Node HTTPS client. */
export async function providerSend(channel,target,edition,store,env={},fetchImpl=globalThis.fetch){
  const url=readingURL(env,edition);
  let endpoint,options;
  if(channel==='push'){
    endpoint=pushEndpoint(target);
    const row=await store.db.prepare('SELECT payload FROM subscriptions WHERE endpoint=?').bind(target).first();
    if(!row)throw Object.assign(new Error('Subscription is no longer active'),{code:'DELIVERY_CANCELLED',definitive:true});
    await configurePush(store,env);
    const saved=await store.db.prepare("SELECT value FROM meta WHERE key='vapid'").first();
    if(!env.VAPID_SUBJECT)throw configurationError('VAPID_SUBJECT is required for phone delivery');
    const keys=JSON.parse(saved.value);
    let details;
    try{
      details=webpush.generateRequestDetails(JSON.parse(row.payload),JSON.stringify({title:edition.title,body:'Your morning reading is ready. Take a quiet moment.',url,editionId:edition.id}),{
        TTL:86400,topic:edition.id.replace(/-/g,'').slice(0,32),
        vapidDetails:{subject:env.VAPID_SUBJECT,publicKey:keys.publicKey,privateKey:keys.privateKey}
      });
    }catch{throw configurationError('Push subscription or signing configuration is invalid');}
    options={method:details.method,headers:details.headers,body:details.body,redirect:'manual',signal:AbortSignal.timeout(15000)};
  }else if(channel==='whatsapp'){
    const settings=await store.settings();
    if(!settings.whatsappEnabled||!settings.whatsappConsent||settings.whatsappPhone!==target)throw Object.assign(new Error('WhatsApp consent was withdrawn'),{code:'DELIVERY_CANCELLED',definitive:true});
    if(!env.WHATSAPP_TOKEN||!env.WHATSAPP_PHONE_NUMBER_ID||!env.WHATSAPP_TEMPLATE_NAME)throw configurationError('WhatsApp provider is not configured');
    const version=env.WHATSAPP_GRAPH_VERSION||'v23.0';
    if(!/^v\d+\.\d+$/.test(version)||!/^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID))throw configurationError('WhatsApp account configuration is invalid');
    endpoint=`https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    options={method:'POST',headers:{Authorization:`Bearer ${env.WHATSAPP_TOKEN}`,'Content-Type':'application/json'},redirect:'manual',signal:AbortSignal.timeout(20000),body:JSON.stringify({messaging_product:'whatsapp',to:target,type:'template',template:{name:env.WHATSAPP_TEMPLATE_NAME,language:{code:env.WHATSAPP_TEMPLATE_LANGUAGE||'en'},components:[{type:'body',parameters:[{type:'text',text:edition.title},{type:'text',text:url}]}]}})};
  }else throw configurationError('Unknown delivery channel');
  const response=await fetchImpl(endpoint,options);
  await response.body?.cancel();
  if(!response.ok)throw Object.assign(new Error(`Provider returned HTTP ${response.status}`),{statusCode:response.status});
}

async function active(store,channel,target){
  if(channel==='push')return !!(await store.db.prepare('SELECT 1 AS active FROM subscriptions WHERE endpoint=?').bind(target).first());
  const settings=await store.settings();
  return settings.whatsappEnabled&&settings.whatsappConsent&&settings.whatsappPhone===target;
}

/** One durable outbox row per edition/channel/target. A claim is committed before
 * I/O, and ambiguous outcomes are held rather than risking duplicate messages. */
export async function deliver(store,edition,{env={},send=providerSend}={}){
  const stale=new Date(Date.now()-5*60000).toISOString();
  await store.db.prepare("UPDATE deliveries SET status='uncertain',error='Interrupted provider request; inspect provider before a manual resend',updated_at=? WHERE status='sending' AND updated_at<=?").bind(nowISO(),stale).run();
  const settings=await store.settings();
  const subscriptions=await store.db.prepare('SELECT endpoint FROM subscriptions').all();
  const targets=subscriptions.results.map(row=>['push',row.endpoint]);
  if(settings.whatsappEnabled&&settings.whatsappConsent)targets.push(['whatsapp',settings.whatsappPhone]);
  if(targets.length)await store.db.batch(targets.map(([channel,target])=>store.db.prepare("INSERT OR IGNORE INTO deliveries(id,edition_id,channel,target,status,attempts,error,updated_at) VALUES(?,?,?,?,'pending',0,NULL,?)").bind(crypto.randomUUID(),edition.id,channel,target,nowISO())));
  const pending=await store.db.prepare("SELECT id,channel,target,attempts FROM deliveries WHERE edition_id=? AND status='pending'").bind(edition.id).all();
  for(const row of pending.results){
    if(!await active(store,row.channel,row.target)){
      await store.db.prepare("UPDATE deliveries SET status='cancelled',updated_at=? WHERE id=? AND status='pending'").bind(nowISO(),row.id).run();
      continue;
    }
    const condition=row.channel==='push'
      ? 'EXISTS(SELECT 1 FROM subscriptions WHERE endpoint=deliveries.target)'
      : "EXISTS(SELECT 1 FROM settings WHERE id=1 AND json_extract(payload,'$.whatsappEnabled')=1 AND json_extract(payload,'$.whatsappConsent')=1 AND json_extract(payload,'$.whatsappPhone')=deliveries.target)";
    const claimed=await store.db.prepare(`UPDATE deliveries SET status='sending',attempts=attempts+1,updated_at=? WHERE id=? AND status='pending' AND attempts<3 AND ${condition}`).bind(nowISO(),row.id).run();
    if(!changes(claimed))continue;
    const claim=await store.db.prepare('SELECT attempts FROM deliveries WHERE id=?').bind(row.id).first();
    if(!await active(store,row.channel,row.target)){
      await store.db.prepare("UPDATE deliveries SET status='cancelled',updated_at=? WHERE id=? AND status='sending'").bind(nowISO(),row.id).run();
      continue;
    }
    try{
      await send(row.channel,row.target,edition,store,env);
      await store.db.prepare("UPDATE deliveries SET status='sent',error=NULL,updated_at=? WHERE id=? AND status='sending'").bind(nowISO(),row.id).run();
    }catch(error){
      const status=Number(error.statusCode)||0;
      const expired=row.channel==='push'&&(status===404||status===410);
      const state=error.code==='DELIVERY_CANCELLED'?'cancelled':expired?'expired':error.definitive?'failed':status===429&&claim.attempts<3?'pending':status>=400&&status<500?'failed':'uncertain';
      const reason=error.code==='DELIVERY_CONFIGURATION'?'Delivery configuration is incomplete or invalid':`Provider ${status||'network'} failure`;
      await store.db.prepare("UPDATE deliveries SET status=?,error=?,updated_at=? WHERE id=? AND status='sending'").bind(state,reason,nowISO(),row.id).run();
      if(expired)await store.db.prepare('DELETE FROM subscriptions WHERE endpoint=?').bind(row.target).run();
    }
  }
  return (await store.db.prepare('SELECT channel,status,attempts FROM deliveries WHERE edition_id=?').bind(edition.id).all()).results;
}
