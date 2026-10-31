/** Explicit operator-only reset. Existing login accounts and sessions are preserved. Back up before running. */
import {config} from '../node/config.js';
import {pool,transaction,closePool} from '../node/db.js';
import {pakistanDate} from '../node/helpers.js';
import {fetchBooking} from '../node/repository.js';
if(process.env.DEMO_DATA_RESET_ALLOWED!=='true'||config.paymentMode!=='demo'||!process.argv.includes('--reset-demo')) {
  throw new Error('Requires PAYMENT_MODE=demo, DEMO_DATA_RESET_ALLOWED=true and --reset-demo. Create a database backup first.');
}
const dates=offset=>{const d=new Date(`${pakistanDate()}T12:00:00+05:00`);d.setUTCDate(d.getUTCDate()+offset);return pakistanDate(d);};
const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const routes=[
  {id:'demo-psh-khi',from:'Peshawar',to:'Karachi',fare:7000,distance:'1,380 km',duration:'14h',boarding:'Madina Terminal, Peshawar'},
  {id:'demo-psh-lhr',from:'Peshawar',to:'Lahore',fare:4200,distance:'520 km',duration:'6h',boarding:'Madina Terminal, Peshawar'},
  {id:'demo-psh-isb',from:'Peshawar',to:'Islamabad',fare:1800,distance:'185 km',duration:'2h 30m',boarding:'Madina Terminal, Peshawar'},
  {id:'demo-khi-psh',from:'Karachi',to:'Peshawar',fare:7000,distance:'1,380 km',duration:'14h',boarding:'Sohrab Goth Terminal, Karachi'},
];
const layouts=[['Standard Plus 49','Standard Plus',49],['Executive 41','Executive',41],['Sleeper 35','Sleeper Bus',35],['Executive 44','Executive',44]];
const names=['Muhammad Usman','Ayesha Bibi','Bilal Ahmed','Sana Khalid','Hamza Ali','Fatima Noor','Abdul Rehman','Maryam Khan','Imran Shah','Hira Malik','Saad Hassan','Zainab Iqbal','Omar Farooq','Mahnoor Aslam','Faisal Rahman','Rabia Nadeem','Tariq Mehmood','Amina Yusuf'];
const drivers=['Muhammad Ameen','Adeel Shah','Faisal Khan','Junaid Ahmed'];
const attendants=['Ayesha Khan','Nazia Bibi','Sadia Noor','Saira Ali'];
const times=['23:45','22:00','19:00','21:30'];
const registrations=['PKC-1029','LHR-2048','ISB-3057','KHI-4066'];
let ticketCount=0;
try{
 await transaction(async c=>{
  const q=async(sql,args=[])=>{const [result]=await c.execute(sql,args);return result;};
  const [admin]=await q("SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1");
  if(!admin)throw new Error('An existing administrator is required; login accounts will not be replaced.');
  for(const table of ['audit_logs','financial_transactions','refunds','booking_seats','bookings','trip_runs','shift_closures','expenses','counter_shifts','trips','crew','buses','routes']) await q(`DELETE FROM ${table}`);
  for(const r of routes)await q("INSERT INTO routes(id,origin,destination,distance,duration,fare,boarding_point,status) VALUES (?,?,?,?,?,?,?,'Active')",[r.id,r.from,r.to,r.distance,r.duration,r.fare,r.boarding]);
  for(let i=0;i<4;i++){
   const [name,service,seats]=layouts[i];
   await q("INSERT INTO buses(id,registration,service,seats,model,model_year,status,next_service,is_template) VALUES (?,?,?,?,?,2026,'Ready','Not scheduled',1)",[`demo-layout-${i}`,`LAYOUT-DEMO-${i}`,service,seats,name]);
   await q("INSERT INTO buses(id,registration,service,seats,model,model_year,status,next_service,is_template) VALUES (?,?,?,?,?,2026,'Ready','Not scheduled',0)",[`demo-vehicle-${i}`,registrations[i],service,seats,name]);
   for(const [name,role,index] of [[drivers[i],'Driver',i*2],[attendants[i],'Female attendant',i*2+1]])await q("INSERT INTO crew(name,role,phone,cnic,license,duty,status,initials) VALUES (?,?,?,?,?,'Terminal roster','Available',?)",[name,role,`0300-00010${String(index).padStart(2,'0')}`,`00000-00000${String(index).padStart(2,'0')}-0`,role==='Driver'?`DEMO-HTV-${i}`:'—',name.split(' ').map(p=>p[0]).join('')]);
   await q("INSERT INTO trips(id,route_id,bus_id,departure,arrival,driver,attendant,platform,status,service_days,active) VALUES (?,?,?,?,?,'','','','Scheduled',?,1)",[`demo-trip-${i}`,routes[i].id,`demo-layout-${i}`,times[i],['13:45','04:00','21:30','11:30'][i],JSON.stringify(days)]);
  }
  for(let offset=-7;offset<=1;offset++){
   const date=dates(offset);
   for(let i=0;i<4;i++){
    const route=routes[i],[model,service,capacity]=layouts[i],tripId=`demo-trip-${i}`,runId=`${tripId}-${date}-run-1`;
    const bus={id:`demo-vehicle-${i}`,registration:registrations[i],service,seats:capacity,model,year:2026,status:'Ready',nextService:'Not scheduled',isTemplate:false};
    const snapshot={routeId:route.id,route,bus,departure:times[i],arrival:['13:45','04:00','21:30','11:30'][i]};
    const past=offset<0;
    await q("INSERT INTO trip_runs(id,trip_id,service_date,bus_id,driver,attendant,platform,status,notes,departed_at,returned_at,snapshot) VALUES (?,?,?,?,?,?,'',?,'Client demonstration journey',?,?,?)",[runId,tripId,date,bus.id,drivers[i],attendants[i],past?'Returned':'Scheduled',past?`${date} ${times[i]}:00`:null,past?`${dates(offset+1)} 15:00:00`:null,JSON.stringify(snapshot)]);
    const count=10+((offset+8+i)%5);
    for(let n=1;n<=count;n++){
     ticketCount++;const nameIndex=(ticketCount+i)%names.length,source=n%3===0?'Public web':'Counter',hold=!past&&n%8===0&&source==='Counter',refunded=past&&n===count,cancelled=past&&n===count-1;
     const id=`demo-ticket-${date}-${i}-${n}`,ticket=`${hold?'RS':'ME'}-${date.replaceAll('-','')}-${i}${String(n).padStart(3,'0')}`;
     const method=source==='Public web'?'1Bill':n%5===0?'Card':'Cash',paid=hold||cancelled?0:route.fare,status=hold?'Reserved':refunded?'Refunded':cancelled?'Cancelled':'Confirmed';
     const ref=paid?`DEMO-${method==='1Bill'?'1BILL':'COUNTER'}-${ticketCount}`:'';
     await q(`INSERT INTO bookings(id,ticket_no,source,passenger,phone,cnic,gender,route_label,destination,boarding_point,bus_registration,service,fare,total,paid,balance,payment_method,payment_reference,payment_status,booking_status,travel_date,travel_time,driver,attendant,trip_id,trip_run_id,seat_printed_at,issued_by,terminal,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,ticket,source,names[nameIndex],`0300-000${String(ticketCount%10000).padStart(4,'0')}`,`00000-${String(ticketCount).padStart(7,'0')}-0`,nameIndex%2?'Female':'Male',`${route.from} → ${route.to}`,route.to,route.boarding,bus.registration,service,route.fare,route.fare,paid,hold?route.fare:0,method,ref,hold||cancelled?'Unpaid':refunded?'Refunded':'Paid',status,date,times[i],drivers[i],attendants[i],tripId,runId,paid?`${date} 08:00:00`:null,'Client demo',route.boarding,admin.id,`${date} 08:${String(n).padStart(2,'0')}:00`]);
     await q('INSERT INTO booking_seats(booking_id,trip_run_id,seat_number,active) VALUES (?,?,?,?)',[id,runId,n,status==='Confirmed'||status==='Reserved'?1:0]);
     if(paid)await q("INSERT INTO financial_transactions(booking_id,transaction_type,amount,payment_method,reference,description,created_by,created_at) VALUES (?,'sale',?,?,?,'Simulated client demo sale',?,?)",[id,paid,method,ref,admin.id,`${date} 08:00:00`]);
     if(refunded){
      const refundId=`demo-refund-${date}-${i}`;
      await q("INSERT INTO refunds(id,booking_id,amount,method,reason,reference,notes,processed_by,processed_at) VALUES (?,?,?,?,'Passenger request',?,'Simulated demonstration refund',?,?)",[refundId,id,paid,method,`DEMO-REFUND-${ticketCount}`,admin.id,`${date} 09:00:00`]);
      await q("INSERT INTO financial_transactions(booking_id,refund_id,transaction_type,amount,payment_method,reference,description,created_by,created_at) VALUES (?,?,'refund',?,?,?,'Simulated client demo refund',?,?)",[id,refundId,-paid,method,`DEMO-REFUND-${ticketCount}`,admin.id,`${date} 09:00:00`]);
     }
    }
    if(past){
      const passengerIds=await q("SELECT id FROM bookings WHERE trip_run_id=? AND booking_status='Confirmed'",[runId]);
      snapshot.passengers=[];for(const record of passengerIds)snapshot.passengers.push(await fetchBooking(record.id,c));
      await q('UPDATE trip_runs SET snapshot=? WHERE id=?',[JSON.stringify(snapshot),runId]);
    }
   }
   for(const [category,description,amount] of [['Fuel','Intercity fuel allocation',8500+(offset+8)*180],['Terminal','Terminal operating costs',2400+(offset+8)*80],['Refreshment','Passenger refreshments',1200+(offset+8)*45]]){
    const ref=`DEMO-EXPENSE-${date}-${category}`;
    await q("INSERT INTO expenses(expense_date,category,description,amount,payment_method,reference,notes,created_by) VALUES (?,?,?,?,'Cash',?,'Synthetic client demonstration data',?)",[date,category,description,amount,ref,admin.id]);
    await q("INSERT INTO financial_transactions(transaction_type,amount,payment_method,reference,description,created_by,created_at) VALUES ('expense',?,'Cash',?,?,?,?)",[-amount,ref,description,admin.id,`${date} 10:00:00`]);
   }
  }
  await q("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,after_json,ip_address) VALUES (?,'demo.reset','system','client-demo',?,'operator-script')",[admin.id,JSON.stringify({synthetic:true,tickets:ticketCount,from:dates(-7),to:dates(1),accountsPreserved:true})]);
 });
 console.log(JSON.stringify({demoReset:true,tickets:ticketCount,travelDates:{from:dates(-7),to:dates(1)},accountsPreserved:true}));
}finally{await closePool();}
