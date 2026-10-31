import seeds from '../data/reserve.json' with { type: 'json' };

export const defaultSettings = {
  deliveryTime:'08:00', timezone:'Africa/Nairobi',
  whatsappEnabled:false, whatsappPhone:'', whatsappConsent:false,
};
export function quoteKey(text) {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
const parseRows = rows => rows.map(row => JSON.parse(row.payload));
const changes = result => Number(result?.meta?.changes || 0);

/** All persistent state belongs to D1, never the lifetime of a Worker isolate. */
export class EdgeStore {
  constructor(db) { this.db=db; }
  async init(initialSeeds=seeds) {
    const version=initialSeeds.map(seed=>seed.id).join('|');
    if(await this.getMeta('seed-import-version')===version) return;
    const statements=[this.db.prepare('INSERT OR IGNORE INTO settings (id,payload) VALUES (1,?)').bind(JSON.stringify(defaultSettings))];
    for(const seed of initialSeeds) {
      this.validateSeed(seed);
      statements.push(this.db.prepare(`INSERT OR IGNORE INTO reserve (id,event_key,quote_key,payload,used)
        SELECT ?,?,?,?,0 WHERE NOT EXISTS (SELECT 1 FROM ledger WHERE event_key=? OR quote_key=?)`)
        .bind(seed.id,seed.eventKey,quoteKey(seed.quote.text),JSON.stringify(seed),seed.eventKey,quoteKey(seed.quote.text)));
    }
    statements.push(this.db.prepare(`INSERT INTO meta (key,value) VALUES ('seed-import-version',?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(version));
    await this.db.batch(statements);
  }
  validateSeed(seed) {
    if(!seed?.id||!seed.eventKey||!seed.sources?.length||!seed.quote?.text||!Array.isArray(seed.paragraphs)) {
      throw new Error('Incomplete researched edition');
    }
  }
  async getMeta(key) {
    const row=await this.db.prepare('SELECT value FROM meta WHERE key=?').bind(key).first();
    return row?.value ?? null;
  }
  async setMetaIfAbsent(key,value) {
    await this.db.prepare('INSERT OR IGNORE INTO meta (key,value) VALUES (?,?)').bind(key,value).run();
    return this.getMeta(key);
  }
  async settings() {
    const row=await this.db.prepare('SELECT payload FROM settings WHERE id=1').first();
    if(!row)throw new Error('D1 migration has not been applied');
    return JSON.parse(row.payload);
  }
  async saveSettings(value) {
    await this.db.prepare('UPDATE settings SET payload=? WHERE id=1').bind(JSON.stringify(value)).run();
    return value;
  }
  async reserve() {
    const {results}=await this.db.prepare('SELECT payload FROM reserve WHERE used=0 ORDER BY rowid').all();
    return parseRows(results);
  }
  async ledger() {
    const {results}=await this.db.prepare('SELECT payload FROM ledger ORDER BY rowid').all();
    return parseRows(results);
  }
  async addReserve(seed) {
    this.validateSeed(seed);
    const key=quoteKey(seed.quote.text);
    const result=await this.db.prepare(`INSERT OR IGNORE INTO reserve (id,event_key,quote_key,payload,used)
      SELECT ?,?,?,?,0 WHERE NOT EXISTS (SELECT 1 FROM ledger WHERE event_key=? OR quote_key=?)`)
      .bind(seed.id,seed.eventKey,key,JSON.stringify(seed),seed.eventKey,key).run();
    return !!changes(result);
  }
  async edition(date) {
    const row=await this.db.prepare('SELECT payload,published FROM editions WHERE date=?').bind(date).first();
    return row?{...JSON.parse(row.payload),published:!!row.published}:null;
  }
  async byId(id) {
    const row=await this.db.prepare('SELECT payload FROM editions WHERE id=? AND published=1').bind(id).first();
    return row?JSON.parse(row.payload):null;
  }
  async archive() {
    const {results}=await this.db.prepare('SELECT payload FROM editions WHERE published=1 ORDER BY date DESC').all();
    return parseRows(results);
  }
  async prepare(date) {
    // D1.batch is transactional. A competing date or event-key insert rolls
    // back the complete allocation; read the winner or choose the next reserve.
    for(let attempt=0;attempt<8;attempt++) {
      const existing=await this.edition(date);
      if(existing)return existing;
      const row=await this.db.prepare('SELECT id,payload FROM reserve WHERE used=0 ORDER BY rowid LIMIT 1').first();
      if(!row)throw new Error('Researched reserve is empty; configure research or add verified editions.');
      const seed=JSON.parse(row.payload);
      const words=[...seed.paragraphs,seed.invitation,seed.quote.text].join(' ').split(/\s+/).length;
      const edition={...seed,id:crypto.randomUUID(),date,readingMinutes:Math.max(2,Math.min(3,Math.ceil(words/210)))};
      const payload=JSON.stringify(edition);
      try {
        await this.db.batch([
          this.db.prepare('INSERT INTO editions (id,date,payload,published) VALUES (?,?,?,0)').bind(edition.id,date,payload),
          this.db.prepare('INSERT INTO ledger (event_key,edition_id,quote_key,payload) VALUES (?,?,?,?)').bind(seed.eventKey,edition.id,quoteKey(seed.quote.text),payload),
          this.db.prepare('UPDATE reserve SET used=1 WHERE id=? AND used=0').bind(row.id),
        ]);
        return {...edition,published:false};
      }catch(error) {
        const winner=await this.edition(date);
        if(winner)return winner;
        if(!/UNIQUE|constraint/i.test(String(error.message)))throw error;
      }
    }
    throw new Error('Edition allocation was busy; retry the scheduled run.');
  }
  async publish(date) {
    await this.prepare(date);
    await this.db.prepare('UPDATE editions SET published=1 WHERE date=?').bind(date).run();
    return this.edition(date);
  }
  async job(id,status,detail='',now=new Date()) {
    await this.db.prepare(`INSERT INTO jobs (id,status,detail,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status,detail=excluded.detail,updated_at=excluded.updated_at`)
      .bind(id,status,detail,now.toISOString()).run();
  }
  async claimResearch(date,nowMs=Date.now()) {
    const id='research:'+date;
    const now=new Date(nowMs).toISOString();
    const retryBefore=new Date(nowMs-5*60_000).toISOString();
    const leaseUntil=nowMs+10*60_000;
    const result=await this.db.prepare(`INSERT INTO jobs (id,status,detail,updated_at,attempts,lease_until)
      VALUES (?,'running','',?,1,?)
      ON CONFLICT(id) DO UPDATE SET status='running',detail='',updated_at=excluded.updated_at,
        attempts=jobs.attempts+1,lease_until=excluded.lease_until
      WHERE jobs.attempts<3 AND (
        jobs.status='complete' OR
        (jobs.status='failed' AND jobs.updated_at<=?) OR
        (jobs.status='running' AND jobs.lease_until<=?)
      )`).bind(id,now,leaseUntil,retryBefore,nowMs).run();
    if(!changes(result))return null;
    const row=await this.db.prepare('SELECT attempts,lease_until FROM jobs WHERE id=?').bind(id).first();
    return {id,attempt:row.attempts,leaseUntil:row.lease_until};
  }
  async researchClaimCurrent(claim) {
    return !!await this.db.prepare("SELECT 1 FROM jobs WHERE id=? AND attempts=? AND lease_until=? AND status='running'")
      .bind(claim.id,claim.attempt,claim.leaseUntil).first();
  }
  async finishResearch(claim,status,detail='',nowMs=Date.now()) {
    await this.db.prepare(`UPDATE jobs SET status=?,detail=?,updated_at=?,lease_until=0
      WHERE id=? AND attempts=? AND lease_until=? AND status='running'`)
      .bind(status,detail.slice(0,500),new Date(nowMs).toISOString(),claim.id,claim.attempt,claim.leaseUntil).run();
  }
}
