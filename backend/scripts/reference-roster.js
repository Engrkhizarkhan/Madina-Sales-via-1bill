/** Apply the client-approved service sheet once, without deleting ticket or financial history. */
import {transaction,closePool} from '../node/db.js';
import {audit} from '../node/operations.js';
if(!process.argv.includes('--apply-reference-roster')) throw new Error('Use --apply-reference-roster after backing up the database.');
const days=JSON.stringify(['Mon','Tue','Wed','Thu','Fri','Sat','Sun']);
const standard='reference-standard49',sleeper='reference-sleeper35',premium='reference-premium41',executive='reference-executive41';
const layouts=[
 [standard,'Standard Plus 49','Standard Plus',49,[],0],
 [sleeper,'Sleeper Bus 35','Sleeper Bus',35,[],0],
 [premium,'Premium Plus 12×29','Premium Plus',41,[{name:'Business',seats:Array.from({length:12},(_,i)=>i+1)},{name:'Executive',seats:Array.from({length:29},(_,i)=>i+13)}],13],
 [executive,'Executive 41','Executive',41,[],13],
];
const service=(busId,times,fares,commissionRate)=>({busId,times,fares,...(commissionRate==null?{}:{commissionRate})});
const karachiTimes=['09:00','10:00','12:00','13:00','14:00','15:00','16:00','17:00','19:00'];
const multanTimes=['19:00','20:00','21:00','22:00'];
const diTimes=['08:00','10:00','10:30','11:00','14:00','15:00','17:00','23:30'];
const routes=[
 ['reference-psh-khi','Karachi',6500,[{name:'Karachi',fare:6500}],[service(standard,karachiTimes,{Karachi:{Standard:6500}},0),service(sleeper,karachiTimes,{Karachi:{Standard:11500}},0)],[[standard,'09:00'],[standard,'12:00'],[standard,'14:00'],[standard,'16:00'],[sleeper,'15:00']]],
 ['reference-psh-bwp','Bahawalpur via Multan',4300,[{name:'Multan',fare:4000},{name:'Bahawalpur',fare:4300}],[service(premium,multanTimes,{Multan:{Business:5000,Executive:4000},Bahawalpur:{Business:5300,Executive:4300}},13),service(executive,multanTimes,{Multan:{Standard:4000},Bahawalpur:{Standard:4300}},13)],[[premium,'19:00'],[executive,'19:00']]],
 ['reference-psh-mul-fsd','Multan via Faisalabad',3600,[{name:'Faisalabad',fare:3000},{name:'Multan',fare:3600}],[service(standard,['10:30','19:00','20:00','21:00','22:00'],{Faisalabad:{Standard:3000},Multan:{Standard:3600}},13)],[[standard,'10:30'],[standard,'21:00']]],
 ['reference-psh-di','D. I. Khan motorway',2200,[{name:'D. I. Khan',fare:2200}],[service(standard,diTimes,{'D. I. Khan':{Standard:2200}},10)],diTimes.map(t=>[standard,t])],
];
try{await transaction(async c=>{
 const [done]=await c.execute("SELECT id FROM audit_logs WHERE action='configuration.reference_roster_20261107' LIMIT 1");
 if(done.length){console.log('Reference roster already applied; management edits preserved.');return;}
 for(const [id,model,type,seats,classes,commission] of layouts)await c.execute("INSERT INTO buses(id,registration,service,seats,model,model_year,status,next_service,is_template,seat_classes,commission_rate) VALUES (?,?,?,?,?,2026,'Ready','Not scheduled',1,?,?)",[id,id.toUpperCase(),type,seats,model,JSON.stringify(classes),commission]);
 for(const [id,to,fare,destinations,services,trips] of routes){
  await c.execute("INSERT INTO routes(id,origin,destination,distance,duration,fare,boarding_point,status,destinations,services) VALUES (?,'Peshawar',?,'','',?,'Madina Terminal, Peshawar','Active',?,?)",[id,to,fare,JSON.stringify(destinations),JSON.stringify(services)]);
  for(const [index,[busId,time]] of trips.entries())await c.execute("INSERT INTO trips(id,route_id,bus_id,departure,arrival,driver,attendant,platform,status,service_days,active) VALUES (?,?,?,?,'00:00','','','','Scheduled',?,1)",[`${id}-${index+1}`,id,busId,time,days]);
 }
 // Replace only the supplied sample roster. Retain every dated run and original ticket.
 await c.execute("UPDATE trips SET active=0,deleted_at=NOW() WHERE id REGEXP '^demo-trip-[0-9]+$'");
 await c.execute("UPDATE routes SET status='Paused',deleted_at=NOW() WHERE id IN ('demo-psh-khi','demo-psh-lhr','demo-psh-isb','demo-khi-psh')");
 await c.execute("UPDATE buses SET deleted_at=NOW() WHERE id REGEXP '^demo-layout-[0-9]+$'");
 // Older bus-wide travel flags do not control independent daily departures.
 await c.execute("UPDATE buses SET status='Ready' WHERE status='On route'");
 await audit('configuration.reference_roster_20261107','configuration','reference-roster',null,{routes:routes.length,schedules:routes.reduce((sum,r)=>sum+r[5].length,0),sleeperFare:11500,noon:'12:00'},null,null,c);
 console.log('Applied 4 routes, 4 bus layouts and 17 daily schedules. Ticket history preserved.');
});}finally{await closePool();}
