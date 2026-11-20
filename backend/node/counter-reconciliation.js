import {pool,transaction} from './db.js';
import {decimal,fail,pakistanDate} from './helpers.js';
import {consistentRead,dateRange,pageMeta,scopeDate,searchTerm} from './admin-records.js';
import {requireOwner} from './account-access.js';
import {audit} from './operations.js';
const sums=['tickets','collected','refunds','cashSales','cashRefunds','cashExpenses','discounts','discountTickets','manualCuts','surcharges','tariffValue','unknownTariffs','handovers','payouts'];
const numberRow=row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,sums.includes(key)?Number(value||0):value]));
function actorFilter(query,alias,staff='created_by'){
 const clauses=[],params=[];
 if(query.staff){const id=Number(query.staff);if(!Number.isSafeInteger(id)||id<1)fail('Choose a valid account.',422,'validation_error');clauses.push(`${alias}.${staff}=?`);params.push(id);}
 if(query.terminal!==undefined&&query.terminal!==''){
  if(query.terminal==='unknown')clauses.push(`${alias}.terminal_slot IS NULL`);
  else {const slot=Number(query.terminal);if(!Number.isInteger(slot)||slot<1||slot>99)fail('Choose a valid counter.',422,'validation_error');clauses.push(`${alias}.terminal_slot=?`);params.push(slot);}
 }
 return {clauses,params};
}
export async function reconciliationPage(query){
 const group=query.group??'day';if(!['day','month'].includes(group))fail('Choose day or month.',422,'validation_error');
 const ledger=dateRange(query,'t.created_at'),la=actorFilter(query,'t');ledger.clauses.push(...la.clauses,"t.transaction_type IN ('sale','refund','expense')");ledger.params.push(...la.params);
 const receipts=dateRange(query,'e.business_date'),ra=actorFilter(query,'e','staff_id');receipts.clauses.push(...ra.clauses);receipts.params.push(...ra.params);
 const period=column=>`DATE_FORMAT(${column},'${group==='month'?'%Y-%m':'%Y-%m-%d'}')`;
 const first="(t.transaction_type='sale' AND t.id=(SELECT MIN(f.id) FROM financial_transactions f WHERE f.booking_id=t.booking_id AND f.transaction_type='sale'))";
 const events=`SELECT ${period('t.created_at')} period,t.created_by staffId,t.terminal_slot terminal,COALESCE(t.actor_name,u.name,'Not recorded') actor,
  IF(${first},1,0) tickets,IF(t.transaction_type='sale',t.amount,0) collected,IF(t.transaction_type='refund',-t.amount,0) refunds,
  IF(t.transaction_type='sale' AND t.payment_method='Cash',t.amount,0) cashSales,IF(t.transaction_type='refund' AND t.payment_method='Cash',-t.amount,0) cashRefunds,
  IF(t.transaction_type='expense' AND t.payment_method='Cash',-t.amount,0) cashExpenses,
  IF(${first},b.discount,0) discounts,IF(${first} AND (b.discount>0 OR b.tariff_total_at_sale>b.total),1,0) discountTickets,
  IF(${first} AND b.tariff_total_at_sale IS NOT NULL,GREATEST(0,b.tariff_total_at_sale-(b.total+b.discount)),0) manualCuts,
  IF(${first} AND b.tariff_total_at_sale IS NOT NULL,GREATEST(0,(b.total+b.discount)-b.tariff_total_at_sale),0) surcharges,
  IF(${first},COALESCE(b.tariff_total_at_sale,0),0) tariffValue,IF(${first} AND b.tariff_total_at_sale IS NULL,1,0) unknownTariffs,
  0 handovers,0 payouts FROM financial_transactions t LEFT JOIN bookings b ON b.id=t.booking_id LEFT JOIN users u ON u.id=t.created_by WHERE ${ledger.clauses.join(' AND ')}
  UNION ALL SELECT ${period('e.business_date')},e.staff_id,e.terminal_slot,e.staff_name,0,0,0,0,0,0,0,0,0,0,0,0,IF(e.kind='Handover',e.amount,0),IF(e.kind='Payout',e.amount,0)
  FROM counter_cash_entries e ${receipts.clauses.length?'WHERE '+receipts.clauses.join(' AND '):''}`;
 const params=[...ledger.params,...receipts.params],totals=sums.map(key=>`COALESCE(SUM(${key}),0) ${key}`).join(','),groupBy='GROUP BY period,staffId,terminal';
 return consistentRead(async c=>{
  const [[summary]]=await c.execute(`SELECT ${totals} FROM (${events}) events`,params);
  const [[count]]=await c.execute(`SELECT COUNT(*) total FROM (SELECT period,staffId,terminal FROM (${events}) events ${groupBy}) groups_list`,params),meta=pageMeta(Number(count.total),query);
  const [rows]=await c.execute(`SELECT period,staffId,terminal,MAX(actor) actor,${totals} FROM (${events}) events ${groupBy} ORDER BY period DESC,actor,terminal LIMIT ${meta.size} OFFSET ${meta.offset}`,params);
  const calculate=row=>{const value=numberRow(row),expectedCash=Math.round((value.cashSales-value.cashRefunds-value.cashExpenses-value.payouts)*100)/100;return {...value,expectedCash,outstanding:Math.round((expectedCash-value.handovers)*100)/100};};
  return {rows:rows.map(calculate),summary:calculate(summary),...meta};
 });
}
export async function priceReviewPage(query){
 const dates=dateRange(query,'t.created_at');dates.clauses.push("t.transaction_type='sale' AND t.id=(SELECT MIN(f.id) FROM financial_transactions f WHERE f.booking_id=b.id AND f.transaction_type='sale')");
 if(query.staff){const id=Number(query.staff);if(!Number.isSafeInteger(id)||id<1)fail('Invalid account.',422,'validation_error');dates.clauses.push('t.created_by=?');dates.params.push(id);}
 if(query.terminal){if(query.terminal==='unknown')dates.clauses.push('t.terminal_slot IS NULL');else{const slot=Number(query.terminal);if(!Number.isInteger(slot)||slot<1||slot>99)fail('Invalid counter.',422,'validation_error');dates.clauses.push('t.terminal_slot=?');dates.params.push(slot);}}
 const search=searchTerm(query.search);if(search){dates.clauses.push("CONCAT_WS(' ',b.ticket_no,b.passenger,b.route_label,b.destination,b.issued_by) LIKE ?");dates.params.push(search);}
 if(query.reductions==='true')dates.clauses.push('(b.discount>0 OR b.tariff_total_at_sale>b.total)');
 return consistentRead(async c=>{const where='WHERE '+dates.clauses.join(' AND '),[[count]]=await c.execute(`SELECT COUNT(*) total FROM bookings b JOIN financial_transactions t ON t.booking_id=b.id ${where}`,dates.params),meta=pageMeta(Number(count.total),query);
  const [rows]=await c.execute(`SELECT b.id,b.ticket_no ticket,t.created_at time,b.passenger,b.route_label route,b.destination,COALESCE(t.actor_name,b.issued_by,'Not recorded') actor,t.terminal_slot terminal,b.payment_method method,b.tariff_total_at_sale tariff,b.discount,b.total,b.booking_status status,(SELECT COALESCE(SUM(amount),0) FROM refunds r WHERE r.booking_id=b.id) refunded FROM bookings b JOIN financial_transactions t ON t.booking_id=b.id ${where} ORDER BY t.created_at DESC,b.id DESC LIMIT ${meta.size} OFFSET ${meta.offset}`,dates.params);
  return {rows:rows.map(row=>({...row,tariff:row.tariff==null?null:Number(row.tariff),discount:Number(row.discount),total:Number(row.total),refunded:Number(row.refunded)})),...meta};
 });
}
export async function cashEntryPage(query){
 const dates=dateRange(query,'e.business_date'),actor=actorFilter(query,'e','staff_id');dates.clauses.push(...actor.clauses);dates.params.push(...actor.params);
 return consistentRead(async c=>{const where=dates.clauses.length?'WHERE '+dates.clauses.join(' AND '):'',[[count]]=await c.execute(`SELECT COUNT(*) total FROM counter_cash_entries e ${where}`,dates.params),meta=pageMeta(Number(count.total),query);
  const [rows]=await c.execute(`SELECT e.id,e.business_date date,e.terminal_slot terminal,e.staff_id staffId,e.staff_name actor,e.kind,e.amount,e.notes,e.recorded_name recordedBy,e.created_at time,e.reverses_id reversesId,(SELECT id FROM counter_cash_entries r WHERE r.reverses_id=e.id) reversedBy FROM counter_cash_entries e ${where} ORDER BY e.created_at DESC,e.id DESC LIMIT ${meta.size} OFFSET ${meta.offset}`,dates.params);
  return {rows:rows.map(row=>({...row,amount:Number(row.amount)})),...meta};
 });
}
function requestKey(body){if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.requestKey!=='string'||! /^[a-f0-9-]{32,64}$/i.test(body.requestKey))fail('Reload this cash entry form before saving.',422,'validation_error');return body.requestKey;}
export async function recordCashEntry(body,user,req){
 requireOwner(user);const key=requestKey(body),date=scopeDate(body.date),staff=Number(body.staff),slot=body.terminal===null||body.terminal==='unknown'?null:Number(body.terminal),amount=decimal(body.amount,'Amount',.01),notes=String(body.notes||'').trim();
 if(date>pakistanDate()||!Number.isSafeInteger(staff)||staff<1||!['Handover','Payout'].includes(body.kind)||!notes||notes.length>500||amount>9999999999.99)fail('Enter an account, date, amount and explanation.',422,'validation_error');
 const [[account]]=await pool.execute('SELECT name FROM users WHERE id=?',[staff]);if(!account)fail('Account not found.',422,'validation_error');
 if(slot!==null){if(!Number.isInteger(slot)||slot<1||slot>99)fail('Choose a valid counter.',422,'validation_error');const [[terminal]]=await pool.execute('SELECT slot FROM terminal_slots WHERE slot=?',[slot]);if(!terminal)fail('Counter PC not found.',422,'validation_error');}
 return transaction(async c=>{
  const [insert]=await c.execute('INSERT INTO counter_cash_entries(business_date,terminal_slot,staff_id,staff_name,kind,amount,notes,request_key,recorded_by,recorded_name) VALUES(?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',[date,slot,staff,account.name,body.kind,amount,notes,key,user.id,user.name]);
  const [[entry]]=await c.execute('SELECT * FROM counter_cash_entries WHERE id=?',[insert.insertId]);
  if(entry.business_date!==date||entry.terminal_slot!==slot||Number(entry.staff_id)!==staff||entry.kind!==body.kind||Number(entry.amount)!==amount||entry.notes!==notes)fail('This request already saved a different cash entry. Refresh and start a new entry.',409,'entry_changed');
  const [[existingAudit]]=await c.execute("SELECT id FROM audit_logs WHERE entity_type='counter_cash' AND entity_id=? AND action=? LIMIT 1 FOR SHARE",[String(entry.id),'cash.'+body.kind.toLowerCase()]);
  if(!existingAudit)await audit('cash.'+body.kind.toLowerCase(),'counter_cash',entry.id,null,{amount,date,staffName:account.name,terminal:slot,notes},user.id,req,c);
  return {ok:true,id:Number(entry.id)};
 });
}
export async function reverseCashEntry(id,body,user,req){
 requireOwner(user);const key=requestKey(body),notes=String(body.notes||'').trim();if(!notes||notes.length>500)fail('Enter the correction reason.',422,'validation_error');
 return transaction(async c=>{
  const [[entry]]=await c.execute('SELECT * FROM counter_cash_entries WHERE id=? FOR UPDATE',[id]);if(!entry||entry.reverses_id||Number(entry.amount)<=0)fail('Choose an original cash entry.',409,'invalid_reversal');
  const [[prior]]=await c.execute('SELECT id,request_key,notes FROM counter_cash_entries WHERE reverses_id=?',[id]);
  if(prior){if(prior.request_key===key&&prior.notes===notes)return {ok:true,id:Number(prior.id)};fail('This entry has already been reversed.',409,'already_reversed');}
  const [result]=await c.execute('INSERT INTO counter_cash_entries(business_date,terminal_slot,staff_id,staff_name,kind,amount,notes,request_key,reverses_id,recorded_by,recorded_name) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[entry.business_date,entry.terminal_slot,entry.staff_id,entry.staff_name,entry.kind,-Number(entry.amount),notes,key,entry.id,user.id,user.name]);
  await audit('cash.reversed','counter_cash',entry.id,{amount:Number(entry.amount)},{amount:-Number(entry.amount),notes,reversalId:result.insertId},user.id,req,c);
  return {ok:true,id:Number(result.insertId)};
 });
}
