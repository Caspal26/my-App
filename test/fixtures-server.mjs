// Browser tests run against the real application with an isolated, disposable SQLite database.
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { createApp } from '../src/server.mjs';
import { localClock } from '../src/time.mjs';
const directory=mkdtempSync(join(tmpdir(),'founders-morning-browser-'));
const store=new Store(join(directory,'test.sqlite'));
const today=localClock(new Date(),'Africa/Nairobi').date;
for(let days=2;days>=0;days--){const date=new Date(`${today}T12:00:00Z`);date.setUTCDate(date.getUTCDate()-days);store.publish(date.toISOString().slice(0,10));}
process.env.APP_URL='http://127.0.0.1:4173';
const {app}=createApp({store,password:'browser-test-passphrase-only',startScheduler:false});
const server=app.listen(4173,'127.0.0.1');
function stop(){server.close(()=>{store.close();rmSync(directory,{recursive:true,force:true});process.exit(0);});}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
