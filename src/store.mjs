import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class Store {
  constructor(path, {seeds=true}={}) {
    if(path!==':memory:') mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.db = new DatabaseSync(path);
    if(path!==':memory:')chmodSync(path,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reserve(id TEXT PRIMARY KEY,event_key TEXT UNIQUE NOT NULL,payload TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS editions(id TEXT PRIMARY KEY,date TEXT UNIQUE NOT NULL,payload TEXT NOT NULL,published INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS ledger(event_key TEXT PRIMARY KEY,edition_id TEXT UNIQUE NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS subscriptions(endpoint TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,edition_id TEXT NOT NULL,channel TEXT NOT NULL,target TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,error TEXT,updated_at TEXT NOT NULL,UNIQUE(edition_id,channel,target));
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,status TEXT NOT NULL,detail TEXT,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    this.db.prepare('INSERT OR IGNORE INTO settings VALUES(1,?)').run(JSON.stringify({deliveryTime:'08:00',timezone:'Africa/Nairobi',whatsappEnabled:false,whatsappPhone:'',whatsappConsent:false}));
    const seedPath=new URL('../data/reserve.json',import.meta.url);
    if(seeds && existsSync(seedPath)) for(const seed of JSON.parse(readFileSync(seedPath,'utf8'))) this.addReserve(seed);
    // A process may have died after a provider accepted a request. Never resend this uncertain attempt automatically.
    this.db.prepare("UPDATE deliveries SET status='uncertain',error='Process stopped during provider request; inspect provider before any manual resend' WHERE status='sending'").run();
  }
  settings(){return JSON.parse(this.db.prepare('SELECT payload FROM settings WHERE id=1').get().payload);}
  saveSettings(s){this.db.prepare('UPDATE settings SET payload=? WHERE id=1').run(JSON.stringify(s));return s;}
  reserve(){return this.db.prepare('SELECT payload FROM reserve WHERE used=0 ORDER BY rowid').all().map(r=>JSON.parse(r.payload));}
  ledger(){return this.db.prepare('SELECT payload FROM ledger ORDER BY rowid').all().map(r=>JSON.parse(r.payload));}
  addReserve(seed){
    if(!seed.id || !seed.eventKey || !seed.sources?.length || !seed.quote?.text) throw new Error('Incomplete researched edition');
    if(this.ledger().some(e=>e.eventKey===seed.eventKey || normalize(e.quote.text)===normalize(seed.quote.text))) return false;
    if(this.reserve().some(e=>normalize(e.quote.text)===normalize(seed.quote.text))) return false;
    return !!this.db.prepare('INSERT OR IGNORE INTO reserve(id,event_key,payload) VALUES(?,?,?)').run(seed.id,seed.eventKey,JSON.stringify(seed)).changes;
  }
  edition(date){const r=this.db.prepare('SELECT payload,published FROM editions WHERE date=?').get(date);return r?{...JSON.parse(r.payload),published:!!r.published}:null;}
  byId(id){const r=this.db.prepare('SELECT payload FROM editions WHERE id=? AND published=1').get(id);return r?JSON.parse(r.payload):null;}
  archive(){return this.db.prepare('SELECT payload FROM editions WHERE published=1 ORDER BY date DESC').all().map(r=>JSON.parse(r.payload));}
  prepare(date){
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const existing=this.edition(date); if(existing){this.db.exec('COMMIT');return existing;}
      const seed=this.reserve()[0]; if(!seed)throw new Error('Researched reserve is empty; configure research or add verified editions.');
      const edition={...seed,id:randomUUID(),date,readingMinutes:Math.max(2,Math.round((seed.paragraphs.join(' ').split(/\s+/).length+seed.invitation.split(/\s+/).length)/190))};
      this.db.prepare('INSERT INTO editions(id,date,payload) VALUES(?,?,?)').run(edition.id,date,JSON.stringify(edition));
      this.db.prepare('INSERT INTO ledger VALUES(?,?,?)').run(seed.eventKey,edition.id,JSON.stringify(edition));
      this.db.prepare('UPDATE reserve SET used=1 WHERE id=?').run(seed.id);
      this.db.exec('COMMIT'); return edition;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  publish(date){this.prepare(date);this.db.prepare('UPDATE editions SET published=1 WHERE date=?').run(date);return this.edition(date);}
  job(id,status,detail=''){this.db.prepare('INSERT INTO jobs VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,detail=excluded.detail,updated_at=excluded.updated_at').run(id,status,detail,new Date().toISOString());}
  close(){this.db.close();}
}
function normalize(s){return s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');}
