import { createHash,randomBytes,timingSafeEqual } from 'node:crypto';
import { EdgeStore } from './store.mjs';
import { configurePush } from './delivery.mjs';
import { runMorning } from './scheduler.mjs';
import { localClock,timeMinute } from '../src/time.mjs';
import { researchEdition } from '../src/research.mjs';

const stores=new WeakMap();
export async function storeFor(env){
  if(!stores.has(env.DB)){
    const store=new EdgeStore(env.DB);
    const pending=store.init().then(()=>store).catch(error=>{stores.delete(env.DB);throw error;});
    stores.set(env.DB,pending);
  }
  return stores.get(env.DB);
}
const digest=text=>createHash('sha256').update(text).digest('hex');
const securityHeaders={
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
function json(data,status=200,headers={}){return Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});}
function sessionToken(request){return (request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('fm_session='))?.slice(11);}
async function authenticated(request,store){
  const token=sessionToken(request);
  return !!(token&&await store.db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND expires>?').bind(digest(token),Date.now()).first());
}
async function readJSON(request){
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw Object.assign(Error('JSON required'),{status:415});
  const reader=request.body?.getReader();let size=0;const chunks=[];
  if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>24576){await reader.cancel();throw Object.assign(Error('Request is too large'),{status:413});}chunks.push(value);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw Object.assign(Error('Invalid JSON'),{status:400});}
}
function researchFor(env){return env.RESEARCH_API_KEY?options=>researchEdition({...options,apiKey:env.RESEARCH_API_KEY,model:env.OPENAI_MODEL||'gpt-4.1',maxAttempts:1}):undefined;}
async function settingsFor(store,env){return {...await store.settings(),researchConfigured:!!env.RESEARCH_API_KEY,whatsappConfigured:!!(env.WHATSAPP_TOKEN&&env.WHATSAPP_PHONE_NUMBER_ID&&env.WHATSAPP_TEMPLATE_NAME),reserveCount:(await store.reserve()).length};}
const reflections=[
 {text:'Caspal, an uncertain outcome does not make today’s careful work meaningless. You know this from the laboratory: a sound process matters before the result arrives. You do not have to solve the whole future of talQen this afternoon.',invitation:'Choose one task small enough to finish in twenty minutes. Let that be enough for this hour.'},
 {text:'You can care deeply about the people who will use talQen and still need rest. Tiredness is information about your capacity today. Give it a place in the plan.',invitation:'Put one non-urgent piece of work down until tomorrow. Write a single next step so you can return without carrying it all evening.'},
 {text:'You are allowed to ask someone to look at a difficult decision with you. A colleague may see a smaller next move while you are holding the whole picture.',invitation:'Ask one trusted person: “What is the smallest useful version of this we could try?”'},
];

async function api(request,env,url){
  const store=await storeFor(env),method=request.method,path=url.pathname;
  const origin=new URL(env.APP_URL||url.origin).origin;
  const secure=origin.startsWith('https:');
  let body;
  if(!['GET','HEAD','OPTIONS'].includes(method)){
    if(request.headers.get('origin')&&request.headers.get('origin')!==origin)return json({error:'Origin is not allowed'},403);
    body=await readJSON(request);
  }
  if(path==='/api/session'&&method==='GET')return json({authenticated:await authenticated(request,store),needsSetup:!(env.APP_PASSWORD?.length>=12)});
  if(path==='/api/login'&&method==='POST'){
    if(!(env.APP_PASSWORD?.length>=12))return json({error:'Configure a private APP_PASSWORD on the server before signing in.'},503);
    const key=digest((request.headers.get('CF-Connecting-IP')||'local')+'|'+env.APP_PASSWORD);
    const previous=await store.db.prepare('SELECT count,until FROM login_attempts WHERE key=?').bind(key).first();
    if(previous?.until>Date.now()&&previous.count>=8)return json({error:'Too many attempts. Try again in 15 minutes.'},429);
    const entered=typeof body?.password==='string'?body.password:'';
    const matches=entered.length>0&&entered.length<=1024&&timingSafeEqual(Buffer.from(digest(entered)),Buffer.from(digest(env.APP_PASSWORD)));
    if(!matches){
      const now=Date.now();
      await store.db.prepare(`INSERT INTO login_attempts (key,count,until) VALUES (?,1,?)
        ON CONFLICT(key) DO UPDATE SET count=CASE WHEN login_attempts.until>? THEN login_attempts.count+1 ELSE 1 END,
        until=CASE WHEN login_attempts.until>? THEN login_attempts.until ELSE excluded.until END`)
        .bind(key,now+900000,now,now).run();
      return json({error:'That password did not match.'},401);
    }
    const token=randomBytes(32).toString('base64url');
    await store.db.batch([
      store.db.prepare('DELETE FROM login_attempts WHERE key=? OR until<?').bind(key,Date.now()),
      store.db.prepare('DELETE FROM sessions WHERE expires<?').bind(Date.now()),
      store.db.prepare('INSERT INTO sessions (token_hash,expires) VALUES (?,?)').bind(digest(token),Date.now()+30*86400000),
    ]);
    return json({ok:true},200,{'Set-Cookie':`fm_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure?'; Secure':''}`});
  }
  if(!await authenticated(request,store))return json({error:'Sign in to your private reading room.'},401);
  if(path==='/api/logout'&&method==='POST'){
    const token=sessionToken(request);if(token)await store.db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(digest(token)).run();
    return json({ok:true},200,{'Set-Cookie':`fm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure?'; Secure':''}`});
  }
  if(path==='/api/today'&&method==='GET'){
    const settings=await settingsFor(store,env),clock=localClock(new Date(),settings.timezone),edition=await store.edition(clock.date);
    const availability=edition?.published?'ready':clock.minute<timeMinute(settings.deliveryTime)?'scheduled':settings.reserveCount?'preparing':'unavailable';
    return json({edition:edition?.published?edition:null,availability,settings});
  }
  if(path==='/api/editions'&&method==='GET')return json({editions:await store.archive()});
  if(path.startsWith('/api/editions/')&&method==='GET'){
    let id;try{id=decodeURIComponent(path.slice('/api/editions/'.length));}catch{return json({error:'Invalid reading ID'},400);}
    const edition=await store.byId(id);return edition?json(edition):json({error:'Reading not found'},404);
  }
  if(path==='/api/settings'&&method==='GET')return json(await settingsFor(store,env));
  if(path==='/api/settings'&&method==='PUT'){
    const current=await store.settings();
    if(typeof body?.deliveryTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.deliveryTime))return json({error:'Choose a valid delivery time.'},400);
    try{new Intl.DateTimeFormat('en',{timeZone:body.timezone||current.timezone}).format();}catch{return json({error:'Unknown timezone'},400);}
    if(body.whatsappEnabled&&(!body.whatsappConsent||!/^\+[1-9]\d{7,14}$/.test(body.whatsappPhone||'')))return json({error:'WhatsApp requires an international phone number and explicit consent.'},400);
    if(body.whatsappEnabled&&!(await settingsFor(store,env)).whatsappConfigured)return json({error:'Configure the official WhatsApp provider and approved template first.'},409);
    await store.saveSettings({...current,deliveryTime:body.deliveryTime,timezone:body.timezone||current.timezone,whatsappEnabled:!!body.whatsappEnabled,whatsappPhone:String(body.whatsappPhone||'').slice(0,20),whatsappConsent:!!body.whatsappConsent});
    return json(await settingsFor(store,env));
  }
  if(path==='/api/push/key'&&method==='GET'){
    if(!env.APP_URL||!env.VAPID_SUBJECT)return json({error:'Set the public app address and notification contact before enabling phone notifications.'},503);
    return json({publicKey:await configurePush(store,env)});
  }
  if(path==='/api/push/subscribe'&&method==='POST'){
    let target;try{target=new URL(body?.endpoint);}catch{return json({error:'Invalid push endpoint'},400);}
    if(target.protocol!=='https:'||target.username||target.password||target.port||!['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(target.hostname)||!body.keys?.p256dh||!body.keys?.auth)return json({error:'Unsupported push subscription'},400);
    await store.db.prepare('INSERT INTO subscriptions (endpoint,payload) VALUES (?,?) ON CONFLICT(endpoint) DO UPDATE SET payload=excluded.payload').bind(body.endpoint,JSON.stringify(body)).run();
    return json({ok:true});
  }
  if(path==='/api/push/subscribe'&&method==='DELETE'){
    await store.db.prepare('DELETE FROM subscriptions WHERE endpoint=?').bind(String(body.endpoint)).run();return json({ok:true});
  }
  if(path==='/api/encouragement'&&method==='POST')return json({...reflections[Math.floor(Math.random()*reflections.length)],kind:'reflection',researched:false});
  if(path==='/api/status'&&method==='GET')return json({reserveCount:(await store.reserve()).length,researchConfigured:!!env.RESEARCH_API_KEY,
    jobs:(await store.db.prepare('SELECT * FROM jobs ORDER BY updated_at DESC LIMIT 10').all()).results,
    deliveries:(await store.db.prepare('SELECT channel,status,attempts,updated_at FROM deliveries ORDER BY updated_at DESC LIMIT 20').all()).results});
  return json({error:'Endpoint not found'},404);
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);let response;
    try{response=url.pathname.startsWith('/api/')?await api(request,env,url):await env.ASSETS.fetch(request);}
    catch(error){console.error('Request failed:',error.message);response=json({error:error.status?error.message:'Something went wrong. Please try again.'},error.status||500);}
    const headers=new Headers(response.headers);
    for(const [key,value]of Object.entries(securityHeaders))headers.set(key,value);
    if(url.protocol==='https:')headers.set('Strict-Transport-Security','max-age=31536000');
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  },
  async scheduled(controller,env,ctx){
    const task=(async()=>{
      const store=await storeFor(env);
      return runMorning(store,{now:new Date(controller.scheduledTime),research:researchFor(env),env});
    })();
    ctx.waitUntil(task);return task;
  },
};
