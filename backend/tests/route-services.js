import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {config} from '../node/config.js';
import {pool,closePool} from '../node/db.js';
import {pakistanDate} from '../node/helpers.js';
if(!/test|qa/i.test(config.db.database)) throw new Error('Use an isolated test database.');
const suffix=Date.now(), username=`services-${suffix}`,password='ServiceQA!2026';
const base=process.env.TEST_API_URL||'http://127.0.0.1:3108';
const [user]=await pool.execute("INSERT INTO users(name,email,username,password_hash,role,force_password_change) VALUES (?,?,?,?,'admin',0)",['Service QA',`${username}@example.invalid`,username,await bcrypt.hash(password,10)]);
let cookie='',csrf='',count=0,busId,routeId;
const tripId=`services-trip-${suffix}`;
const tomorrow=pakistanDate(new Date(Date.now()+86400000)),today=pakistanDate();
const check=(value,label)=>{assert.ok(value,label);count++;console.log(`PASS ${label}`);};
async function req(method,path,body){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,'X-Forwarded-For':`198.51.100.${suffix%200+1}`},body:body?JSON.stringify(body):undefined});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return {status:response.status,...await response.json()};}
try{
 const login=await req('POST','/auth/login',{identity:username,password});csrf=login.csrfToken;
 const classes=[{name:'Business',seats:Array.from({length:12},(_,i)=>i+1)},{name:'Executive',seats:Array.from({length:29},(_,i)=>i+13)}];
 const busDraft={model:'Premium 12×29',service:'Premium Plus',seats:41,isTemplate:true,commissionRate:13,seatClasses:classes};
 let result=await req('POST','/buses/new',busDraft);busId=result.bus?.id;check(result.status===200&&result.bus.seatClasses[0].seats.length===12,'management saves named seat classes and a fixed bus commission');
 check((await req('PUT',`/buses/${busId}`,{...result.bus,seatClasses:[{name:'Business',seats:[1,42]}]})).status===422,'seat class numbers cannot exceed capacity');
 check((await req('PUT',`/buses/${busId}`,{...result.bus,seatClasses:[{name:'Business',seats:[1]},{name:'Executive',seats:[1]}]})).status===422,'seat classes cannot overlap');
 let route={from:'Peshawar',to:'Bahawalpur via Multan',fare:4300,distance:'',duration:'',boarding:'Terminal',status:'Active',destinations:[{name:'Multan',fare:4000},{name:'Bahawalpur',fare:4300}],services:[{busId,times:['19:00','20:00','21:00','22:00'],commissionRate:13,fares:{Multan:{Business:5000,Executive:4000},Bahawalpur:{Business:5300,Executive:4300}}}]};
 result=await req('POST','/routes/new',route);routeId=result.route?.id;check(result.status===200&&result.route.services[0].times.length===4,'management saves per-bus time choices and destination fares');
 route=result.route;
 check((await req('PUT',`/routes/${routeId}`,{...route,services:[{...route.services[0],times:['25:00']}]})).status===422,'invalid 24-hour times are rejected');
 await pool.execute("INSERT INTO trips(id,route_id,bus_id,departure,arrival,driver,attendant,platform,status,service_days,active) VALUES (?,?,?,'19:00','23:00','','','','Scheduled',?,1)",[tripId,routeId,busId,JSON.stringify(['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])]);
 const holdDraft={tripId,date:tomorrow,seats:[1],passenger:'Phone reservation',phone:'03000000000',bookingStatus:'Reserved',destination:'Multan'};
 result=await req('POST','/bookings',holdDraft);const hold=result.booking;
 check(result.status===201&&hold.gender==='Unspecified'&&hold.cnic===''&&hold.paid===0&&!hold.seatPrintedAt,'name and phone alone reserve a seat without issuing a ticket');
 check(/^RS-[0-9A-Z]{6}$/.test(hold.ticketNo),'reservation reference is short and unique');
 check((await req('POST','/bookings',{...holdDraft,seats:[2],passenger:''})).status===422,'reservation still requires passenger name');
 check((await req('POST','/bookings',{...holdDraft,seats:[2],phone:''})).status===422,'reservation still requires phone');
 check((await req('POST',`/bookings/${hold.id}/confirm`,{paymentMethod:'Cash'})).status===422,'payment conversion requires missing passenger identification');
 result=await req('POST',`/bookings/${hold.id}/confirm`,{cnic:'17301-0000000-1',gender:'Female',destination:'Bahawalpur',discount:300,paymentMethod:'Cash'});
 check(result.status===200&&result.booking.fare===5300&&result.booking.total===5000&&result.booking.gender==='Female','conversion accepts identity, destination, gender and discount at the counter');
 check(/^ME-[0-9A-Z]{6}$/.test(result.booking.ticketNo),'issued ticket has a short independent ticket number');
 const paidDraft={...holdDraft,bookingStatus:'Confirmed',cnic:'17301-0000000-1',gender:'Male'};
 result=await req('POST','/bookings',{...paidDraft,seats:[2,13],destination:'Bahawalpur',discount:1000});
 check(result.status===201&&result.bookings.length===2&&result.bookings[0].fare===5300&&result.bookings[1].fare===4300,'one selection prices each Business and Executive seat separately');
 check(result.bookings.reduce((sum,b)=>sum+b.total,0)===8600,'mixed-class discount totals reconcile exactly');
 check((await req('POST','/bookings',{...paidDraft,seats:[3],destination:'Unknown'})).status===422,'passengers cannot select destinations outside the route');
 check((await req('POST','/public/bookings',{...paidDraft,seats:[3],destination:'Multan',fare:1,total:1})).booking.paid===5000,'public ticket pricing uses managed destination and class fares');
 check((await req('POST','/bookings',{...paidDraft,seats:[4],gender:'Unspecified'})).status===422,'paid tickets require a selected gender');
 const run=(await req('GET',`/trip-runs?date=${tomorrow}`)).runs.find(r=>r.tripId===tripId);
 const voucher={commissionRate:13,manualCommission:0,refreshments:100,terminalExpense:0,toll:0,misc:0,paidToDriver:0,driver:'Driver',attendant:''};
 let payload={date:tomorrow,registration:'',departure:'19:00',layoutBusId:busId,expected:{registration:'',departure:'19:00',revision:'',busId},voucher};
 check((await req('PUT',`/trips/${tripId}/counter`,payload)).error.code==='vehicle_required','voucher requires a vehicle number even though ticketing does not');
 payload={...payload,registration:`SERV-${suffix}`};
 check((await req('PUT',`/trips/${tripId}/counter`,{...payload,voucher:{...voucher,commissionRate:0}})).error.code==='commission_fixed','counter cannot override managed fixed commission');
 check((await req('PUT',`/trips/${tripId}/counter`,{...payload,voucher:{...voucher,manualCommission:50}})).error.code==='commission_fixed','additional commission cannot bypass a fixed rate');
 result=await req('PUT',`/trips/${tripId}/counter`,payload);const saved=result.trip?.snapshot?.voucher;
 check(result.status===200&&saved.basis===18600&&saved.commission===2418&&saved.totalRemaining===16082,'voucher totals include all payment methods after commission and refreshments');
 const [ledger]=await pool.execute('SELECT SUM(amount) total FROM financial_transactions WHERE booking_id IN (SELECT id FROM bookings WHERE trip_run_id=?)',[run.id]);
 check(Number(ledger[0].total)===saved.basis,'voucher collections reconcile with the immutable sales ledger');
 const changed=structuredClone(route);changed.services[0].fares.Multan.Business=5100;
 check((await req('PUT',`/routes/${routeId}`,changed)).status===200,'management can change fares after seats have been issued');
 result=await req('POST','/bookings',{...paidDraft,seats:[4],destination:'Multan'});
 check(result.booking.fare===5100,'new tickets on an existing departure use updated managed fares');
 check((await req('POST','/bookings',{...paidDraft,seats:[6],destination:'Multan',quotedFares:[5000]})).error.code==='fare_changed','stale fare quotes require review before collection');
 result=await req('POST',`/trips/${tripId}/transition`,{date:today,action:'depart'});
 check(result.status===200&&result.trip.status==='Departed','daily departure can close without a vehicle number');
 check((await req('POST',`/trips/${tripId}/transition`,{date:today,action:'return'})).status===422,'there is no return action');
 result=await req('PUT',`/trips/${tripId}/counter`,{...payload,date:today,expected:{registration:'',departure:'19:00',revision:'',busId}});
 check(result.status===200&&result.trip.snapshot.bus.registration===payload.registration,'a missing vehicle number can be added with the voucher after bus gone');
 check((await req('POST','/bookings',{...paidDraft,seats:[5],destination:'Multan'})).status===201,'closing today does not lock tomorrow’s tickets');
 const race=await Promise.all([req('POST','/bookings',{...paidDraft,seats:[40]}),req('POST','/bookings',{...paidDraft,seats:[40]})]);
 check(race.filter(r=>r.status===201).length===1&&race.filter(r=>r.status===409).length===1,'simultaneous users cannot double book a destination seat');
 check((await req('PUT',`/trips/${tripId}/counter`,payload)).status===409,'stale vouchers cannot overwrite another operator’s save');
 const overrideSale = await req('POST', '/bookings', {
   ...paidDraft, seats: [7, 14], destination: 'Multan', quotedFares: [5100, 4000], fareOverrides: [5150.50, null],
 });
 check(overrideSale.status === 201 && overrideSale.bookings.map(booking => booking.paid).join(',') === '5150.5,4000',
   'counter fare edits apply only to the selected ticket');
 const [overrideLedger] = await pool.execute('SELECT amount FROM financial_transactions WHERE booking_id=?', [overrideSale.booking.id]);
 check(Number(overrideLedger[0]?.amount) === 5150.50, 'edited fare reaches the sales ledger');
 check((await req('POST', '/bookings', { ...paidDraft, seats: [8], fareOverrides: [-50] })).status === 422,
   'invalid manual fare is rejected');
 const webOverride = await req('POST', '/public/bookings', {
   ...paidDraft, seats: [8], destination: 'Multan', fareOverrides: [1],
 });
 check(webOverride.status === 201 && webOverride.booking.paid === 5100, 'public checkout uses the managed fare');
 const held = await req('POST', '/bookings', { ...holdDraft, seats: [9], fareOverrides: [1] });
 check(held.status === 201 && held.booking.total === 5100 && held.booking.paid === 0,
   'a reservation retains the managed fare and stays unpaid');
 const collected = await req('POST', `/bookings/${held.booking.id}/confirm`, {
   cnic: paidDraft.cnic, gender: paidDraft.gender, paymentMethod: 'Cash', fareOverrides: [5150],
 });
 check(collected.status === 200 && collected.booking.paid === 5150, 'reservation payment uses the edited fare');
 console.log(`\n${count} route service checks passed.`);
}finally{
 await pool.execute('DELETE FROM financial_transactions WHERE booking_id IN (SELECT id FROM bookings WHERE trip_id=?) OR created_by=?',[tripId,user.insertId]);
 await pool.execute('DELETE FROM expenses WHERE created_by=?',[user.insertId]);
 await pool.execute('DELETE FROM refunds WHERE booking_id IN (SELECT id FROM bookings WHERE trip_id=?)',[tripId]);
 await pool.execute('DELETE FROM booking_seats WHERE booking_id IN (SELECT id FROM bookings WHERE trip_id=?)',[tripId]);
 await pool.execute('DELETE FROM bookings WHERE trip_id=?',[tripId]);
 await pool.execute('DELETE FROM trip_runs WHERE trip_id=?',[tripId]);
 await pool.execute('DELETE FROM trips WHERE id=?',[tripId]);
 await pool.execute('DELETE FROM audit_logs WHERE user_id=?',[user.insertId]);
 await pool.execute('DELETE FROM api_sessions WHERE user_id=?',[user.insertId]);
 if(routeId)await pool.execute('DELETE FROM routes WHERE id=?',[routeId]);
 if(busId)await pool.execute('DELETE FROM buses WHERE id=?',[busId]);
 await pool.execute("DELETE FROM buses WHERE registration=?",[`SERV-${suffix}`]);
 await pool.execute('DELETE FROM users WHERE id=?',[user.insertId]);
 await closePool();
}
