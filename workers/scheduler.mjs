import { localClock,nextDate,timeMinute } from '../src/time.mjs';
import { deliver } from './delivery.mjs';

async function replenish(store,date,research,now) {
  if(!research||(await store.reserve()).length>=5)return;
  const claim=await store.claimResearch(date,now.getTime());
  if(!claim)return;
  try {
    const ledger=await store.ledger();
    const candidate=await research({ledger,quotes:ledger.map(e=>e.quote),reserveEvents:await store.reserve()});
    if(!await store.researchClaimCurrent(claim))return;
    if(!await store.addReserve(candidate))throw new Error('Research repeated an event or quote');
    await store.finishResearch(claim,'complete','',now.getTime());
  }catch(error) {
    await store.finishResearch(claim,'failed',String(error.message),now.getTime());
    console.error('Research failed; keeping verified reserve:',error.message);
  }
}

/** Called by a Cron Trigger; no timer or continuously running process exists. */
export async function runMorning(store,{now=new Date(),research,send,env={}}={}) {
  const settings=await store.settings();
  const {date,minute}=localClock(now,settings.timezone);
  const due=timeMinute(settings.deliveryTime);
  const outcomes=[];
  for(const candidate of [{date,until:due-minute},{date:nextDate(date),until:1440+due-minute}]) {
    if(candidate.until>45)continue;
    const available=!!(await store.edition(candidate.date)||(await store.reserve()).length);
    const researchAfterDelivery=candidate.until<=0&&available;
    if(!researchAfterDelivery)await replenish(store,candidate.date,research,now);
    try {
      const prepared=await store.prepare(candidate.date);
      if(candidate.until<=0) {
        const edition=await store.publish(candidate.date);
        await deliver(store,edition,{send,env});
        await store.job('morning:'+candidate.date,'complete','',now);
        outcomes.push({date:candidate.date,published:true,editionId:edition.id});
      }else outcomes.push({date:candidate.date,published:false,editionId:prepared.id});
    }catch(error) {
      await store.job('morning:'+candidate.date,'failed',String(error.message),now);
      outcomes.push({date:candidate.date,published:false,error:String(error.message)});
      console.error('Morning job:',error.message);
    }
    if(researchAfterDelivery)await replenish(store,candidate.date,research,now);
  }
  return outcomes;
}
