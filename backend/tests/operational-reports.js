import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {randomBytes} from 'node:crypto';
import {config} from '../node/config.js';
import {pool,closePool} from '../node/db.js';
import {app} from '../node/app.js';
import {pakistanDate} from '../node/helpers.js';
if(!/test|qa/i.test(config.db.database)||config.terminal.local||config.terminal.cloud)throw Error('Use an isolated standalone QA database.');
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}`,suffix=randomBytes(5).toString('hex'),prefix='reports-'+suffix;
const ids={route:prefix+'-route',bus:prefix+'-bus',trip:prefix+'-trip'},password='Reports-QA!2026';
const date=pakistanDate(new Date(Date.now()+86400000)),otherDate=pakistanDate(new Date(Date.now()+2*86400000)),today=pakistanDate();
const [[oldPin]]=await pool.query("SELECT CAST(setting_value AS CHAR) value FROM settings WHERE setting_key='finance_pin_hash'");
let cookie='',csrf='',checks=0,userId;
const check=(value,label)=>{assert.ok(value,label);checks++;console.log('PASS',label);};
async function req(method,path,body,authenticated=true){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(authenticated?{Cookie:cookie,'X-CSRF-Token':csrf}:{})},body:body?JSON.stringify(body):undefined});const result=await response.json();return {status:response.status,...result,cookie:response.headers.get('set-cookie')?.split(';')[0]};}
try{
 const [user]=await pool.execute("INSERT INTO users(name,username,password_hash,role,is_owner,remote_allowed,force_password_change) VALUES(?,?,?,'admin',1,1,0)",['Reports owner',prefix,await bcrypt.hash(password,4)]);userId=user.insertId;
 await pool.execute("INSERT INTO routes(id,origin,destination,distance,duration,fare,boarding_point,status) VALUES (?,'Peshawar',?,'','',500,'Terminal','Active')",[ids.route,prefix]);
 await pool.execute("INSERT INTO buses(id,registration,service,seats,model,model_year,status,next_service) VALUES (?,?,'Standard Plus',49,'QA',2026,'Ready','Not scheduled')",[ids.bus,prefix]);
 await pool.execute("INSERT INTO trips(id,route_id,bus_id,departure,arrival,driver,attendant,platform,status,service_days,active) VALUES (?,?,?,'19:00','20:00','','','','Scheduled',?,1)",[ids.trip,ids.route,ids.bus,JSON.stringify(['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])]);
 const login=await req('POST','/auth/login',{identity:prefix,password});check(login.status===200,'report owner logs in');cookie=login.cookie;csrf=login.csrfToken;
 const draft={tripId:ids.trip,date,passenger:prefix,phone:'03001234567',cnic:'1730112345671',gender:'Male',paymentMethod:'Cash'};
 let result=await req('POST','/bookings',{...draft,seats:[1],fareOverrides:[1]});
 check(result.status===201&&result.booking.paid===1,'one-rupee ticket created through real API');const fractional=result.booking;
 check((await req('POST',`/bookings/${fractional.id}/refunds`,{amount:.66,method:'Cash',reason:'Passenger request'})).status===201,'partial refund leaves 34 paisa');
 check((await req('POST',`/bookings/${fractional.id}/refunds`,{amount:.35,method:'Cash',reason:'Passenger request'})).status===422,'refund cannot exceed the remaining 34 paisa');
 result=await req('POST',`/bookings/${fractional.id}/refunds`,{amount:.34,method:'Cash',reason:'Passenger request'});
 check(result.status===201&&result.booking.bookingStatus==='Refunded','remaining 34 paisa can be refunded fully');
 result=await req('POST','/public/bookings',{...draft,seats:[2]},false);check(result.status===201,'public reservation created');
 const [[held]]=await pool.execute('SELECT id FROM bookings WHERE ticket_no=?',[result.bookings[0].ticketNo]);
 result=await req('POST',`/bookings/${held.id}/confirm`,{cnic:draft.cnic,gender:'Male',paymentMethod:'Cash',source:'Counter'});
 check(result.status===200&&result.booking.source==='Public web'&&result.booking.seatPrintedAt,'cash collection keeps the public source and stores sale time');
 result=await req('POST','/bookings',{...draft,seats:Array.from({length:28},(_,i)=>i+3),bookingStatus:'Reserved'});check(result.status===201&&result.bookings.length===28,'reservation register fixture created');
 for(const size of [10,20,50,100]){result=await req('GET',`/admin/booking-page?kind=passengers&search=${prefix}&size=${size}`);check(result.status===200&&result.total===30&&result.rows.length===Math.min(size,30),`server limits register page to ${size}`);}
 result=await req('GET',`/admin/booking-page?kind=reservations&search=${prefix}&size=10&page=2`);check(result.total===28&&result.rows.length===10&&result.page===2,'reservation page and count use the same filter');
 check((await req('GET','/admin/booking-page?size=500')).status===422,'unbounded page size is rejected');
 check((await req('GET','/admin/booking-page',undefined,false)).status===401,'register data requires staff authentication');
 result=await req('GET',`/admin/bootstrap?date=${otherDate}`);check(result.status===200&&result.bookings.every(b=>b.date===otherDate)&&!result.bookings.some(b=>b.id===held.id),'seat bootstrap excludes other service dates');
 const cursor=result.liveCursor;await req('POST','/bookings',{...draft,seats:[31],bookingStatus:'Reserved'});
 result=await req('GET',`/admin/changes?date=${otherDate}&cursor=${encodeURIComponent(cursor)}`);check(result.status===200&&result.changed&&result.bookings.length===0&&result.runs.length===0,'scoped live cursor advances without downloading other days');
 check((await req('GET','/admin/bootstrap?date=2026-02-30')).status===422,'invalid calendar date is rejected');
 check((await req('GET',`/finance/sales-report?from=${today}&to=${today}`)).status===403,'new financial reports require the finance PIN');
 await req('PUT','/finance/pin',{pin:'765432',currentPassword:password});
 check((await req('POST','/auth/finance-unlock',{pin:'765432'})).status===200,'owner unlocks reports using finance PIN');
 for(const group of ['day','route','bus','counter','seller','source']){result=await req('GET',`/finance/sales-report?from=${today}&to=${today}&group=${group}&size=100`);check(result.status===200&&result.summary.tickets===2&&result.summary.collected===501&&result.summary.refunds===1&&result.summary.net===500,`accurate counts and refunds grouped by ${group}`);}
 result=await req('GET',`/finance/sales-report?from=${today}&to=${today}&group=source`);check(result.rows.find(row=>row.label==='Public web').tickets===1&&result.rows.find(row=>row.label==='Counter').tickets===1,'web-origin ticket is counted separately from counter-created sales');
 result=await req('PUT',`/trips/${ids.trip}/counter`,{date,registration:prefix,departure:'19:00',expected:{registration:prefix,departure:'19:00',revision:''},voucher:{commissionRate:10,manualCommission:0,refreshments:2.34,terminalExpense:0,toll:0,misc:0,paidToDriver:100,driver:'QA',attendant:''}});
 check(result.status===200&&result.trip.snapshot.voucher.deductions===52.34,'voucher calculates commission plus fractional costs');
 result=await req('GET',`/finance/settlements?from=${date}&to=${date}`);const settlement=result.rows.find(row=>row.id.startsWith(ids.trip));
 check(result.status===200&&settlement.saved&&!settlement.stale&&settlement.remaining===447.66&&settlement.paidToDriver===100,'departure report shows remaining money after costs and driver handover');
 result=await req('GET',`/finance/sales-report?from=${today}&to=${date}`);check(result.summary.commissions===50&&result.summary.expenses===52.34,'commission is not deducted twice from net collections');
 result=await req('GET',`/admin/run-page?status=History&from=${date}&to=${otherDate}&size=10`);check(result.status===200&&result.rows.some(row=>row.id.startsWith(ids.trip))&&result.rows.every(row=>!row.snapshot?.passengers?.length),'history range works independently and excludes embedded passenger history');
 result=await req('GET',`/expenses?from=${today}&to=${date}&size=10`);check(result.status===200&&result.amount===52.34&&result.rows.length===1,'expense totals cover the filtered range');
 console.log(`${checks} operational report checks passed.`);
}finally{
 if(oldPin)await pool.execute("UPDATE settings SET setting_value=? WHERE setting_key='finance_pin_hash'",[oldPin.value]);
 else await pool.execute("DELETE FROM settings WHERE setting_key='finance_pin_hash'");
 await pool.execute('DELETE FROM audit_logs WHERE user_id=?',[userId||0]);
 await pool.execute('DELETE ft FROM financial_transactions ft LEFT JOIN bookings b ON b.id=ft.booking_id WHERE ft.created_by=? OR b.trip_id=?',[userId||0,ids.trip]);
 await pool.execute('DELETE FROM expenses WHERE created_by=?',[userId||0]);await pool.execute('DELETE r FROM refunds r JOIN bookings b ON b.id=r.booking_id WHERE b.trip_id=?',[ids.trip]);
 await pool.execute('DELETE bs FROM booking_seats bs JOIN bookings b ON b.id=bs.booking_id WHERE b.trip_id=?',[ids.trip]);
 await pool.execute('DELETE FROM bookings WHERE trip_id=?',[ids.trip]);await pool.execute('DELETE FROM trip_runs WHERE trip_id=?',[ids.trip]);await pool.execute('DELETE FROM trips WHERE id=?',[ids.trip]);
 await pool.execute('DELETE FROM buses WHERE id=?',[ids.bus]);await pool.execute('DELETE FROM routes WHERE id=?',[ids.route]);await pool.execute('DELETE FROM api_sessions WHERE user_id=?',[userId||0]);await pool.execute('DELETE FROM users WHERE id=?',[userId||0]);
 await new Promise(resolve=>server.close(resolve));await closePool();
}
