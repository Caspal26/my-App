import 'dotenv/config';
import { Store } from '../src/store.mjs';
import { researchEdition } from '../src/research.mjs';
import { resolve,join } from 'node:path';
const store=new Store(join(resolve(process.env.DATA_DIR||'var'),'morning.sqlite'));
try{
  const ledger=store.ledger();
  const edition=await researchEdition({ledger,quotes:ledger.map(e=>e.quote),reserveEvents:store.reserve()});
  if(!store.addReserve(edition))throw new Error('Repeated event or quote was not added');
  console.log(`Verified and reserved: ${edition.title}`);
  console.log(`Sources: ${edition.sources.map(s=>s.url).join('\n')}`);
}catch(e){console.error(e.message);process.exitCode=1;}finally{store.close();}
