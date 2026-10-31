import 'dotenv/config';
import express from 'express';
import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes,createHash,scryptSync,timingSafeEqual } from 'node:crypto';
import { Store } from './store.mjs';
import { configurePush } from './delivery.mjs';
import { Scheduler } from './scheduler.mjs';
import { localClock,timeMinute } from './time.mjs';
import { researchEdition } from './research.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export function createApp({store=new Store(join(resolve(process.env.DATA_DIR||join(root,'var')),'morning.sqlite')),password=process.env.APP_PASSWORD||'',startScheduler=false}={}) {
  const app=express();
  const salt=randomBytes(16),passwordHash=scryptSync(password,salt,64);
  const publicKey=configurePush(store);
  const appUrl=process.env.APP_URL||process.env.RENDER_EXTERNAL_URL||'http://localhost:3000';
  const secure=new URL(appUrl).protocol==='https:';
  app.disable('x-powered-by');app.set('trust proxy',1);
  app.use((req,res,next)=>{
    res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});
    if(secure)res.set('Strict-Transport-Security','max-age=31536000');
    if(req.path.startsWith('/api/'))res.set('Cache-Control','no-store');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)){
      const origin=req.get('origin');
      if(origin&&origin!==new URL(appUrl).origin)return res.status(403).json({error:'Origin is not allowed'});
      if(!req.is('application/json'))return res.status(415).json({error:'JSON required'});
    }
    next();
  });
  app.use(express.json({limit:'24kb'}));
  const digest=s=>createHash('sha256').update(s).digest('hex');
  function authenticated(req){
    const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('fm_session='))?.slice(11);
    if(!token)return false;
    return !!store.db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND expires>?').get(digest(token),Date.now());
  }
  app.get('/api/session',(req,res)=>res.json({authenticated:authenticated(req),needsSetup:password.length<12}));
  const attempts=new Map();
  app.post('/api/login',(req,res)=>{
    if(password.length<12)return res.status(503).json({error:'Set APP_PASSWORD (at least 12 characters) on the server before signing in.'});
    const key=req.ip,old=attempts.get(key)||{count:0,until:0};
    if(old.until>Date.now()&&old.count>=8)return res.status(429).json({error:'Too many attempts. Try again in 15 minutes.'});
    const entered=typeof req.body.password==='string'?req.body.password:'';
    if(!entered||entered.length>1024||!timingSafeEqual(scryptSync(entered,salt,64),passwordHash)){
      attempts.set(key,{count:old.until>Date.now()?old.count+1:1,until:Date.now()+900000});
      return res.status(401).json({error:'That password did not match.'});
    }
    attempts.delete(key);
    const token=randomBytes(32).toString('base64url');
    store.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    store.db.prepare('INSERT INTO sessions VALUES(?,?)').run(digest(token),Date.now()+30*86400000);
    res.set('Set-Cookie',`fm_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure?'; Secure':''}`).json({ok:true});
  });
  app.use('/api',(req,res,next)=>authenticated(req)?next():res.status(401).json({error:'Sign in to your private reading room.'}));
  app.post('/api/logout',(req,res)=>{
    const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('fm_session='))?.slice(11);
    if(token)store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
    res.set('Set-Cookie','fm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0').json({ok:true});
  });
  const researchConfigured=!!(process.env.RESEARCH_API_KEY||process.env.OPENAI_API_KEY);
  function settings(){return {...store.settings(),whatsappConfigured:!!(process.env.WHATSAPP_TOKEN&&process.env.WHATSAPP_PHONE_NUMBER_ID&&process.env.WHATSAPP_TEMPLATE_NAME),researchConfigured,reserveCount:store.reserve().length};}
  app.get('/api/today',(req,res)=>{
    const clock=localClock(new Date(),store.settings().timezone),edition=store.edition(clock.date);
    const availability=edition?.published?'ready':clock.minute<timeMinute(store.settings().deliveryTime)?'scheduled':store.reserve().length?'preparing':'unavailable';
    res.json({edition:edition?.published?edition:null,availability,settings:settings()});
  });
  app.get('/api/editions',(req,res)=>res.json({editions:store.archive()}));
  app.get('/api/editions/:id',(req,res)=>{const e=store.byId(req.params.id);e?res.json(e):res.status(404).json({error:'Reading not found'});});
  app.get('/api/settings',(req,res)=>res.json(settings()));
  app.put('/api/settings',(req,res)=>{
    const b=req.body,s=store.settings();
    if(typeof b.deliveryTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.deliveryTime))return res.status(400).json({error:'Choose a valid delivery time.'});
    try{new Intl.DateTimeFormat('en',{timeZone:b.timezone||s.timezone}).format();}catch{return res.status(400).json({error:'Unknown timezone'});}
    if(b.whatsappEnabled&&(!b.whatsappConsent||!/^\+[1-9]\d{7,14}$/.test(b.whatsappPhone||'')))return res.status(400).json({error:'WhatsApp requires an international phone number and explicit consent.'});
    if(b.whatsappEnabled&&!settings().whatsappConfigured)return res.status(409).json({error:'Configure the official WhatsApp provider and approved template on the server first.'});
    store.saveSettings({...s,deliveryTime:b.deliveryTime,timezone:b.timezone||s.timezone,whatsappEnabled:!!b.whatsappEnabled,whatsappPhone:String(b.whatsappPhone||'').slice(0,20),whatsappConsent:!!b.whatsappConsent});
    res.json(settings());
  });
  app.get('/api/push/key',(req,res)=>res.json({publicKey}));
  app.post('/api/push/subscribe',(req,res)=>{
    const subscription=req.body;
    // Restrict outbound notification endpoints to browser push providers to prevent SSRF.
    let u;try{u=new URL(subscription.endpoint);}catch{return res.status(400).json({error:'Invalid push endpoint'});}
    if(u.protocol!=='https:'||u.username||u.password||u.port||!['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(u.hostname)||!subscription.keys?.p256dh||!subscription.keys?.auth)return res.status(400).json({error:'Unsupported push subscription'});
    store.db.prepare('INSERT INTO subscriptions VALUES(?,?) ON CONFLICT(endpoint) DO UPDATE SET payload=excluded.payload').run(subscription.endpoint,JSON.stringify(subscription));res.json({ok:true});
  });
  app.delete('/api/push/subscribe',(req,res)=>{store.db.prepare('DELETE FROM subscriptions WHERE endpoint=?').run(String(req.body.endpoint));res.json({ok:true});});
  app.post('/api/encouragement',(req,res)=>{
    const choices=[{text:'Caspal, an uncertain outcome does not make today’s careful work meaningless. You know this from the laboratory: a sound process matters before the result arrives. You do not have to solve the whole future of talQen this afternoon.',invitation:'Choose one task small enough to finish in twenty minutes. Let that be enough for this hour.'},{text:'You can care deeply about the people who will use talQen and still need rest. Tiredness is information about your capacity today. Give it a place in the plan.',invitation:'Put one non-urgent piece of work down until tomorrow. Write a single next step so you can return without carrying it all evening.'},{text:'You are allowed to ask someone to look at a difficult decision with you. A colleague may see a smaller next move while you are holding the whole picture.',invitation:'Ask one trusted person: “What is the smallest useful version of this we could try?”'}];
    res.json({...choices[Math.floor(Math.random()*choices.length)],kind:'reflection',researched:false});
  });
  app.get('/api/status',(req,res)=>res.json({reserveCount:store.reserve().length,researchConfigured,jobs:store.db.prepare('SELECT * FROM jobs ORDER BY updated_at DESC LIMIT 10').all(),deliveries:store.db.prepare('SELECT channel,status,attempts,updated_at FROM deliveries ORDER BY updated_at DESC LIMIT 20').all()}));
  app.use(express.static(join(root,'public'),{etag:true,maxAge:0}));
  app.get('/',(req,res)=>res.sendFile(join(root,'public/index.html')));
  app.use((err,req,res,next)=>{console.error('Request failed:',err.message);res.status(500).json({error:'Something went wrong. Please try again.'});});
  const scheduler=new Scheduler(store,{research:researchConfigured?researchEdition:undefined});
  if(startScheduler)scheduler.start();
  return {app,store,scheduler};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {app,store,scheduler}=createApp({startScheduler:true});
  const server=app.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log(`Founder's Morning listening on port ${process.env.PORT||3000}`));
  process.on('SIGTERM',()=>{scheduler.stop();server.close(()=>{store.close();process.exit(0);});});
}
