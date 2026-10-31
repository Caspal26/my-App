export function localClock(now, timezone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
  return { date:`${p.year}-${p.month}-${p.day}`, minute:Number(p.hour)*60+Number(p.minute) };
}
export function nextDate(date) { return new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10); }
export function timeMinute(time) { const [h,m]=time.split(':').map(Number); return h*60+m; }
