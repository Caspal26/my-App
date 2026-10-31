import { localClock,nextDate,timeMinute } from './time.mjs';
import { deliver } from './delivery.mjs';

export class Scheduler {
  constructor(store,{research,send}={}){this.store=store;this.research=research;this.send=send;this.busy=false;}
  async replenish(date){
    const id='research:'+date;
    const job=this.store.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    if(job || !this.research || this.store.reserve().length>=5)return;
    this.store.job(id,'running');
    try{
      // Keep a small buffer; each addition is verified independently against every earlier candidate.
      for(let i=0;i<3&&this.store.reserve().length<5;i++){
        const ledger=this.store.ledger();
        const seed=await this.research({ledger,quotes:ledger.map(x=>x.quote),reserveEvents:this.store.reserve()});
        if(!this.store.addReserve(seed))throw new Error('Research repeated an event or quote');
      }
      this.store.job(id,'complete');
    }catch(e){this.store.job(id,'failed',String(e.message).slice(0,500));console.error('Research failed; preserving verified reserve:',e.message);}
  }
  async run(now=new Date()){
    if(this.busy)return;
    this.busy=true;
    try{
      const {date,minute}=localClock(now,this.store.settings().timezone);
      const due=timeMinute(this.store.settings().deliveryTime);
      // Include tomorrow for delivery times shortly after midnight.
      const candidates=[{date,until:due-minute},{date:nextDate(date),until:1440+due-minute}];
      for(const candidate of candidates){
        if(candidate.until>45)continue;
        // A catch-up run should deliver the existing reserve promptly, even if a research provider is slow.
        const researchAfterDelivery=candidate.until<=0&&!!(this.store.edition(candidate.date)||this.store.reserve().length);
        if(!researchAfterDelivery)await this.replenish(candidate.date);
        try{
          this.store.prepare(candidate.date);
          if(candidate.until<=0){
            const edition=this.store.publish(candidate.date);
            await deliver(this.store,edition,this.send);
            this.store.job('morning:'+candidate.date,'complete');
          }
        }catch(e){this.store.job('morning:'+candidate.date,'failed',e.message);console.error('Morning job:',e.message);}
        if(researchAfterDelivery)await this.replenish(candidate.date);
      }
    }finally{this.busy=false;}
  }
  start(){this.run().catch(console.error);this.timer=setInterval(()=>this.run().catch(console.error),30000);this.timer.unref();}
  stop(){clearInterval(this.timer);}
}
