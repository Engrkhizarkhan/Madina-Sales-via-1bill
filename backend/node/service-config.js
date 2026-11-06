import {decimal,fail} from './helpers.js';
export function validateClasses(value,capacity) {
  if(!Array.isArray(value)||value.length>8) fail('Enter valid seat classes.',422,'validation_error');
  const seen=new Set(), names=new Set();
  return value.map(group=>{
    const name=String(group.name||'').trim();
    if(!name||name.length>50||names.has(name)||!Array.isArray(group.seats)||!group.seats.length) fail('Each seat class needs a unique name and seat numbers.',422,'validation_error');
    names.add(name);
    const seats=group.seats.map(Number);
    for(const seat of seats){if(!Number.isInteger(seat)||seat<1||seat>capacity||seen.has(seat)) fail('Seat classes must use unique seat numbers within capacity.',422,'validation_error');seen.add(seat);}
    return {name,seats};
  });
}
export function validateRouteConfig(data,fleet) {
  if(!Array.isArray(data.destinations)||!Array.isArray(data.services)||data.destinations.length>20||data.services.length>50) fail('Invalid route configuration.',422,'validation_error');
  const destinations=data.destinations.map(stop=>({name:String(stop.name||'').trim(),fare:decimal(stop.fare,'destination fare')}));
  if(destinations.some(s=>!s.name||s.name.length>120)||new Set(destinations.map(s=>s.name)).size!==destinations.length) fail('Destination names must be unique.',422,'validation_error');
  const names=destinations.length?destinations.map(d=>d.name):[data.to];
  const busIds=new Set();
  const services=data.services.map(item=>{
    const bus=fleet.find(b=>b.id===item.busId&&!b.deleted&&b.isTemplate);
    if(!bus||busIds.has(bus.id)) fail('Choose a different managed bus for each service.',422,'validation_error');
    busIds.add(bus.id);
    if(!Array.isArray(item.times)||item.times.length>96||item.times.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) fail('Departure choices must use HH:MM (24-hour time).',422,'validation_error');
    const classes=[...new Set(['Standard',...(bus.seatClasses||[]).map(g=>g.name)])];
    const fares={};
    for(const destination of names){
      fares[destination]={};
      for(const name of classes) if(item.fares?.[destination]?.[name]!==undefined) fares[destination][name]=decimal(item.fares[destination][name],'seat fare');
    }
    const commissionRate=item.commissionRate==null?undefined:decimal(item.commissionRate,'commission rate');
    if(commissionRate>100) fail('Commission cannot exceed 100%.',422,'validation_error');
    return {busId:bus.id,times:[...new Set(item.times)].sort(),fares,...(commissionRate==null?{}:{commissionRate})};
  });
  return {destinations,services};
}
