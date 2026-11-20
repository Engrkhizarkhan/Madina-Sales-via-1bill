import {consistentRead,dateRange,pageMeta} from './admin-records.js';
import {fail} from './helpers.js';
const numeric=row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,['tickets','seats','collected','refunds','net','expenses','commissions','deductions','basis','paidToDriver'].includes(key)?Number(value||0):value]));
export async function salesReport(query){
 const dimensions={day:"DATE(t.created_at)",route:'b.route_label',bus:"CONCAT(b.bus_registration,' · ',b.service)",counter:"CASE WHEN b.sold_terminal_slot IS NOT NULL THEN CONCAT('PC ',b.sold_terminal_slot) WHEN b.sold_from IS NOT NULL THEN b.sold_from ELSE 'Not recorded' END",seller:"COALESCE(NULLIF(b.issued_by,''),'Not recorded')",source:'b.source'};
 const dimension=query.group??'day',basis=query.basis??'collection';
 if(!Object.hasOwn(dimensions,dimension)||!['collection','travel'].includes(basis))fail('Choose a supported sales report.',422,'validation_error');
 const group=dimension==='day'&&basis==='travel'?'b.travel_date':dimensions[dimension];
 const dates=dateRange(query,basis==='travel'?'b.travel_date':'t.created_at'),where=dates.clauses.length?'WHERE '+dates.clauses.join(' AND '):'';
 const from=`FROM financial_transactions t JOIN bookings b ON b.id=t.booking_id LEFT JOIN (SELECT booking_id,MIN(id) first_id FROM financial_transactions WHERE transaction_type='sale' GROUP BY booking_id) first_sale ON first_sale.booking_id=b.id`;
 const values=`SUM(t.id=first_sale.first_id) tickets,COALESCE(SUM(CASE WHEN t.id=first_sale.first_id THEN (SELECT COUNT(*) FROM booking_seats s WHERE s.booking_id=b.id) ELSE 0 END),0) seats,COALESCE(SUM(CASE WHEN t.transaction_type='sale' THEN t.amount ELSE 0 END),0) collected,COALESCE(SUM(CASE WHEN t.transaction_type='refund' THEN -t.amount ELSE 0 END),0) refunds,COALESCE(SUM(t.amount),0) net`;
 return consistentRead(async c=>{
  const [[totals]]=await c.execute(`SELECT ${values} ${from} ${where}`,dates.params);
  const [[count]]=await c.execute(`SELECT COUNT(DISTINCT ${group}) total ${from} ${where}`,dates.params),meta=pageMeta(Number(count.total),query);
  const [groups]=await c.execute(`SELECT ${group} label,${values} ${from} ${where} GROUP BY ${group} ORDER BY ${dimension==='day'?'label DESC':'tickets DESC,label'} LIMIT ${meta.size} OFFSET ${meta.offset}`,dates.params);
  const expenseDates=dateRange(query,'e.expense_date'),expenseWhere=expenseDates.clauses.length?'WHERE '+expenseDates.clauses.join(' AND '):'';
  const [[costs]]=await c.execute(`SELECT COALESCE(SUM(e.amount),0) expenses FROM expenses e ${expenseWhere}`,expenseDates.params);
  const [[commission]]=await c.execute(`SELECT COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(tr.snapshot,'$.voucher.commission')) AS DECIMAL(14,2))),0) commissions FROM trip_runs tr JOIN expenses e ON e.id=CAST(JSON_UNQUOTE(JSON_EXTRACT(tr.snapshot,'$.voucher.expenseId')) AS UNSIGNED) ${expenseWhere}`,expenseDates.params);
  const [methods]=await c.execute(`SELECT t.payment_method label,COALESCE(SUM(t.amount),0) net ${from} ${where} GROUP BY t.payment_method`,dates.params);
  const [channels]=await c.execute(`SELECT b.source label,COALESCE(SUM(t.id=first_sale.first_id),0) tickets ${from} ${where} GROUP BY b.source`,dates.params);
  return {channels:channels.map(numeric),rows:groups.map(numeric),summary:numeric({...totals,...costs,...commission}),methods:methods.map(numeric),basis,...meta};
 });
}
export async function settlementPage(query){
 const dates=dateRange(query,'tr.service_date');
 dates.clauses.push("(EXISTS(SELECT 1 FROM bookings b WHERE b.trip_run_id=tr.id AND b.paid>0) OR JSON_EXTRACT(tr.snapshot,'$.voucher') IS NOT NULL)");
 const where='WHERE '+dates.clauses.join(' AND ');
 return consistentRead(async c=>{
  const [[count]]=await c.execute(`SELECT COUNT(*) total FROM trip_runs tr ${where}`,dates.params),meta=pageMeta(Number(count.total),query);
  const [rows]=await c.execute(`SELECT tr.id,tr.service_date date,
    CONCAT(JSON_UNQUOTE(JSON_EXTRACT(tr.snapshot,'$.route.from')),' → ',JSON_UNQUOTE(JSON_EXTRACT(tr.snapshot,'$.route.to'))) route,
    JSON_UNQUOTE(JSON_EXTRACT(tr.snapshot,'$.bus.registration')) bus,
    (SELECT COUNT(*) FROM bookings b WHERE b.trip_run_id=tr.id AND b.paid>0) tickets,
    (SELECT COALESCE(SUM(t.amount),0) FROM financial_transactions t JOIN bookings b ON b.id=t.booking_id WHERE b.trip_run_id=tr.id) net,
    JSON_EXTRACT(tr.snapshot,'$.voucher') IS NOT NULL saved,
    JSON_EXTRACT(tr.snapshot,'$.voucher.commission') commissions,JSON_EXTRACT(tr.snapshot,'$.voucher.deductions') deductions,
    JSON_EXTRACT(tr.snapshot,'$.voucher.basis') basis,JSON_EXTRACT(tr.snapshot,'$.voucher.paidToDriver') paidToDriver
    FROM trip_runs tr ${where} ORDER BY tr.service_date DESC,tr.id DESC LIMIT ${meta.size} OFFSET ${meta.offset}`,dates.params);
  return {rows:rows.map(row=>{const value=numeric(row);return {...value,saved:Boolean(row.saved),stale:Boolean(row.saved)&&Math.abs(value.net-value.basis)>.005,remaining:Math.round((value.net-value.deductions)*100)/100};}),...meta};
 });
}
