import calendar from "@/lib/market/cme-holidays.json";
const holidays=new Set(calendar.holidays.filter(h=>h.kind==="closed").map(h=>h.date));
const ny=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"});
export function eligibleSlot(ms:number):boolean {
 const d=new Date(ms),w=d.getUTCDay(),h=d.getUTCHours(),m=d.getUTCMinutes();
 if(holidays.has(ny.format(d)))return false;
 if(w>=1&&w<=5)return h>=5&&h<=21?[6,21,36,51].includes(m):m===6;
 return w===0&&h>=22&&m===6;
}
export function twoMissedSlots(now:number,latest:number):boolean {
 const d=new Date(now);
 if(d.getUTCDay()===6||(d.getUTCDay()===0&&d.getUTCHours()<22)||holidays.has(ny.format(d)))return false;
 const base=Math.floor((now-10*60000)/60000)*60000;
 let missed=0;
 for(let i=0;i<180;i++){const slot=base-i*60000;if(eligibleSlot(slot)){if(latest>=slot)return false;if(++missed===2)return true;}}
 return false;
}
