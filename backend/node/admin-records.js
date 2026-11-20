import {pool} from './db.js';
import {fail,pakistanDate} from './helpers.js';
import {fetchBookings,fetchTripRuns,fetchExpenses} from './repository.js';
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function scopeDate(value){if(value===undefined||value==='')return pakistanDate();if(typeof value!=='string'||!validDate(value))fail('Choose a valid service date.',422,'validation_error');return value;}
export function pageOptions(query){
 const size=Number(query.size??20),page=Number(query.page??1);
 if(![10,20,50,100].includes(size)||!Number.isSafeInteger(page)||page<1||page>10000000)fail('Choose a valid page and page size.',422,'validation_error');
 return {size,page};
}
export function dateRange(query,column){
 const clauses=[],params=[];
 for(const key of ['from','to'])if(query[key]!==undefined&&query[key]!==''&&(typeof query[key]!=='string'||!validDate(query[key])))fail('Choose valid report dates.',422,'validation_error');
 if(query.from&&query.to&&query.from>query.to)fail('The end date must follow the start date.',422,'validation_error');
 if(query.from){clauses.push(`${column}>=?`);params.push(query.from);}
 if(query.to){clauses.push(`${column}<DATE_ADD(?,INTERVAL 1 DAY)`);params.push(query.to);}
 return {clauses,params};
}
export async function consistentRead(read){const connection=await pool.getConnection();try{await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await connection.beginTransaction();const value=await read(connection);await connection.commit();return value;}catch(error){await connection.rollback();throw error;}finally{connection.release();}}
export function searchTerm(value){if(value===undefined||value==='')return '';if(typeof value!=='string'||value.length>160)fail('Use a search of up to 160 characters.',422,'validation_error');return '%'+value.trim().replace(/[\\%_]/g,'\\$&')+'%';}
export function pageMeta(total,query){const {size,page}=pageOptions(query);const pages=Math.max(1,Math.ceil(total/size)),actual=Math.min(page,pages);return {total,size,page:actual,pages,offset:(actual-1)*size};}
export async function bookingPage(query){
 const {clauses,params}=dateRange(query,'b.travel_date');
 if(query.kind==='bookings')clauses.push("b.paid>0 AND b.booking_status<>'Reserved'");
 else if(query.kind==='reservations')clauses.push("b.booking_status='Reserved'");
 else if(query.kind!==undefined&&query.kind!=='passengers')fail('Choose a valid register.',422,'validation_error');
 if(query.status&&query.status!=='All'){if(!['Confirmed','Reserved','Cancelled','Refunded'].includes(query.status))fail('Invalid status.',422,'validation_error');clauses.push('b.booking_status=?');params.push(query.status);}
 if(query.source&&query.source!=='All'){if(!['Public web','Counter'].includes(query.source))fail('Invalid booking source.',422,'validation_error');clauses.push('b.source=?');params.push(query.source);}
 if(query.runId){if(typeof query.runId!=='string'||query.runId.length>190)fail('Invalid departure.',422,'validation_error');clauses.push('b.trip_run_id=?');params.push(query.runId);}
 const term=searchTerm(query.search);
 if(term){clauses.push(`(CONCAT_WS(' ',b.ticket_no,b.reservation_no,b.passenger,b.phone,b.cnic,b.route_label,b.bus_registration,b.issued_by,CONCAT('PC ',b.sold_terminal_slot)) LIKE ? OR EXISTS(SELECT 1 FROM refunds r WHERE r.booking_id=b.id AND CONCAT_WS(' ',r.reason,r.reference,r.notes) LIKE ?))`);params.push(term,term);}
 const where=clauses.length?'WHERE '+clauses.join(' AND '):'';
 return consistentRead(async connection=>{
  const [[count]]=await connection.execute(`SELECT COUNT(*) total FROM bookings b ${where}`,params),meta=pageMeta(Number(count.total),query);
  const [ids]=await connection.execute(`SELECT b.id FROM bookings b ${where} ORDER BY b.created_at DESC,b.id DESC LIMIT ${meta.size} OFFSET ${meta.offset}`,params);
  return {rows:await fetchBookings(connection,ids.map(row=>row.id)),...meta};
 });
}
export async function runPage(query){
 const {clauses,params}=dateRange(query,'tr.service_date');
 if(query.status==='Departed')clauses.push("tr.status='Departed'");
 else if(query.status==='History'){/* Include every recorded departure in the chosen dates. */}
 else if(query.status!==undefined&&query.status!=='All')fail('Invalid departure status.',422,'validation_error');
 const where=clauses.length?'WHERE '+clauses.join(' AND '):'';
 return consistentRead(async c=>{
  const [[count]]=await c.execute(`SELECT COUNT(*) total FROM trip_runs tr ${where}`,params),meta=pageMeta(Number(count.total),query);
  const [ids]=await c.execute(`SELECT tr.id FROM trip_runs tr ${where} ORDER BY tr.service_date DESC,tr.id DESC LIMIT ${meta.size} OFFSET ${meta.offset}`,params);
  const rows=(await fetchTripRuns(null,c,ids.map(row=>row.id),true)).map(run=>({...run,snapshot:run.snapshot?{...run.snapshot,passengers:[]}:null}));
  return {rows,...meta};
 });
}
export async function expensePage(query){
 const {clauses,params}=dateRange(query,'e.expense_date'),where=clauses.length?'WHERE '+clauses.join(' AND '):'';
 return consistentRead(async c=>{
  const [[count]]=await c.execute(`SELECT COUNT(*) total,COALESCE(SUM(e.amount),0) amount FROM expenses e ${where}`,params),meta=pageMeta(Number(count.total),query);
  const [ids]=await c.execute(`SELECT e.id FROM expenses e ${where} ORDER BY e.expense_date DESC,e.id DESC LIMIT ${meta.size} OFFSET ${meta.offset}`,params);
  return {rows:await fetchExpenses(c,ids.map(row=>row.id)),amount:Number(count.amount),...meta};
 });
}
export async function dashboardSummary(query){
 const {clauses,params}=dateRange(query,'travel_date');
 const [rows]=await pool.execute(`SELECT booking_status status,source,COUNT(*) tickets,COALESCE(SUM((SELECT COUNT(*) FROM booking_seats s WHERE s.booking_id=b.id)),0) seats FROM bookings b ${clauses.length?'WHERE '+clauses.join(' AND '):''} GROUP BY booking_status,source`,params);
 return {groups:rows.map(row=>({...row,tickets:Number(row.tickets),seats:Number(row.seats)}))};
}
