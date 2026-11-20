import {pool,transaction} from './db.js';
import {fail,parseJson,uuid} from './helpers.js';
import {requireOwner} from './account-access.js';
import {saleIdentity} from './sale-identity.js';
import {consistentRead,pageMeta,searchTerm,dateRange} from './admin-records.js';
import {audit} from './operations.js';
const tables={route:'routes',bus:'buses',trip:'trips',crew:'crew'};
const labelFor=(type,row)=>type==='route'?`${row.origin} → ${row.destination}`:type==='bus'?`${row.model} · ${row.registration}`:type==='trip'?`Departure ${String(row.departure).slice(0,5)} · ${row.route_id}`:row.name;
export async function hideCatalog(type,id,user,req){
 const table=tables[type];if(!table)fail('Unknown record.',422,'validation_error');
 const reason=String(req.body?.reason||'Removed from operations').trim();if(!reason||reason.length>500)fail('Enter a reason of up to 500 characters.',422,'validation_error');
 return transaction(async c=>{
  const [[row]]=await c.execute(`SELECT * FROM ${table} WHERE id=? AND deleted_at IS NULL FOR UPDATE`,[id]);if(!row)fail('This record is already hidden or was not found.',404,'not_found');
  const actor=saleIdentity(user,req),root=uuid('removal-');
  const save=async(kind,record,parent=null)=>{
   const removal=parent?uuid('removal-'):root;
   const [[route]]=kind==='trip'?await c.execute('SELECT origin,destination FROM routes WHERE id=?',[record.route_id]):[[null]];
   const label=route?`${route.origin} → ${route.destination} · ${String(record.departure).slice(0,5)}`:labelFor(kind,record);
   await c.execute('INSERT INTO catalog_removals(id,entity_type,entity_id,label,parent_id,snapshot,removed_by,removed_name,terminal_slot,reason) VALUES(?,?,?,?,?,?,?,?,?,?)',[removal,kind,String(record.id),label,parent,JSON.stringify(record),user.id,actor.name,actor.terminalSlot,reason]);
   await c.execute(`UPDATE ${tables[kind]} SET deleted_at=NOW()${kind==='trip'?',active=0':kind==='route'?",status='Paused'":''} WHERE id=?`,[record.id]);
   await audit(kind+'.hidden',kind,record.id,record,{deleted:true,review:'Pending',reason,removalId:removal,label},user.id,req,c);
  };
  await save(type,row);
  if(type==='route'||type==='bus'){
   const [children]=await c.execute(`SELECT * FROM trips WHERE ${type==='route'?'route_id':'bus_id'}=? AND deleted_at IS NULL ORDER BY id FOR UPDATE`,[id]);
   for(const child of children)await save('trip',child,root);
  }
  return {ok:true,review:'Pending'};
 });
}
async function restoreRecord(c,item){
 const table=tables[item.entity_type],[[row]]=await c.execute(`SELECT * FROM ${table} WHERE id=? FOR UPDATE`,[item.entity_id]);
 if(!row)fail('The archived record no longer exists.',409,'record_missing');
 if(!row.deleted_at)return;
 const prior=parseJson(item.snapshot,{});
 if(item.entity_type==='trip'){
  const [[route]]=await c.execute('SELECT status,deleted_at FROM routes WHERE id=? FOR SHARE',[row.route_id]);
  const [[bus]]=await c.execute('SELECT is_template,status,deleted_at FROM buses WHERE id=? FOR SHARE',[row.bus_id]);
  if(!route||route.deleted_at||route.status!=='Active'||!bus||bus.deleted_at||bus.status==='Retired')fail('Restore and activate the associated route and bus first.',409,'setup_unavailable');
  if(prior.active!==0){
   const [others]=await c.execute('SELECT * FROM trips WHERE id<>? AND active=1 AND deleted_at IS NULL AND departure=?',[row.id,row.departure]);
   if(others.some(t=>parseJson(t.service_days,[]).some(day=>parseJson(row.service_days,[]).includes(day))&&((!bus.is_template&&t.bus_id===row.bus_id)||(row.driver&&t.driver===row.driver)||(row.attendant&&t.attendant===row.attendant))))fail('This bus or crew has a conflicting schedule. Resolve it before restoring.',409,'roster_conflict');
  }
 }
 await c.execute(`UPDATE ${table} SET deleted_at=NULL${item.entity_type==='trip'?',active=?':item.entity_type==='route'?',status=?':''} WHERE id=?`,[...(item.entity_type==='trip'?[prior.active===0?0:1]:item.entity_type==='route'?[prior.status==='Paused'?'Paused':'Active']:[]),item.entity_id]);
}
async function hasHistory(c,item){
 const id=item.entity_id;
 const sql={trip:['SELECT 1 FROM bookings WHERE trip_id=? UNION ALL SELECT 1 FROM trip_runs WHERE trip_id=? LIMIT 1',[id,id]],route:["SELECT 1 FROM trips WHERE route_id=? UNION ALL SELECT 1 FROM trip_runs WHERE JSON_UNQUOTE(JSON_EXTRACT(snapshot,'$.routeId'))=? LIMIT 1",[id,id]],bus:["SELECT 1 FROM trips WHERE bus_id=? UNION ALL SELECT 1 FROM trip_runs WHERE bus_id=? OR JSON_UNQUOTE(JSON_EXTRACT(snapshot,'$.bus.layoutId'))=? UNION ALL SELECT 1 FROM routes WHERE JSON_CONTAINS(services,JSON_OBJECT('busId',?)) LIMIT 1",[id,id,id,id]],crew:["SELECT 1 FROM trips WHERE driver=(SELECT name FROM crew WHERE id=?) OR attendant=(SELECT name FROM crew WHERE id=?) UNION ALL SELECT 1 FROM bookings WHERE driver=(SELECT name FROM crew WHERE id=?) OR attendant=(SELECT name FROM crew WHERE id=?) UNION ALL SELECT 1 FROM trip_runs WHERE driver=(SELECT name FROM crew WHERE id=?) OR attendant=(SELECT name FROM crew WHERE id=?) UNION ALL SELECT 1 FROM audit_logs WHERE entity_type='crew' AND entity_id=? AND action='crew.updated' LIMIT 1",[id,id,id,id,id,id,id]]};
 const [rows]=await c.execute(...sql[item.entity_type]);return rows.length>0;
}
export async function reviewRemoval(id,action,user,req){
 requireOwner(user);if(req.body?.confirm!==true)fail('Confirm this admin review action.',422,'confirmation_required');
 if(!['restore','approve','purge'].includes(action))fail('Unknown review action.',422,'validation_error');
 return transaction(async c=>{
  const [[item]]=await c.execute('SELECT * FROM catalog_removals WHERE id=? FOR UPDATE',[id]);if(!item)fail('Archived record not found.',404,'not_found');
  const desired={restore:'Restored',approve:'Approved',purge:'Purged'}[action];
  if(item.status===desired)return {ok:true,status:desired,affected:0};
  if(['Restored','Purged'].includes(item.status))fail('This removal has already been resolved. Refresh the list.',409,'review_changed');
  const entries=[item];
  if(action==='restore'){
   await restoreRecord(c,item);
   const prior=parseJson(item.snapshot,{});
   const restoreChildren=!(item.entity_type==='route'&&prior.status==='Paused')&&!(item.entity_type==='bus'&&prior.status==='Retired');
   const [children]=await c.execute("SELECT * FROM catalog_removals WHERE parent_id=? AND status IN ('Pending','Approved') ORDER BY entity_id FOR UPDATE",[id]);
   if(restoreChildren)for(const child of children){await restoreRecord(c,child);entries.push(child);}
  }else if(action==='approve'){
   const [children]=await c.execute("SELECT * FROM catalog_removals WHERE parent_id=? AND status='Pending' ORDER BY entity_id FOR UPDATE",[id]);entries.push(...children);
  }else if(action==='purge'){
   const [[children]]=await c.execute("SELECT COUNT(*) count FROM catalog_removals WHERE parent_id=? AND status IN ('Pending','Approved')",[id]);
   if(children.count||await hasHistory(c,item))fail('This record has linked schedules or journey history. Approve its archive to retain the financial audit trail.',409,'history_retained');
   const [result]=await c.execute(`DELETE FROM ${tables[item.entity_type]} WHERE id=? AND deleted_at IS NOT NULL`,[item.entity_id]);if(!result.affectedRows)fail('This record is no longer hidden.',409,'review_changed');
  }
  const status={restore:'Restored',approve:'Approved',purge:'Purged'}[action];
  for(const entry of entries){
   await c.execute('UPDATE catalog_removals SET status=?,reviewed_by=?,reviewed_name=?,reviewed_at=NOW() WHERE id=?',[status,user.id,user.name,entry.id]);
   await audit('recovery.'+action,entry.entity_type,entry.entity_id,{removalId:entry.id,status:entry.status},{status,label:entry.label},user.id,req,c);
  }
  return {ok:true,status,affected:entries.length};
 });
}
export async function recoveryPage(query){
 const conditions=[],params=[];
 if(query.status&&query.status!=='All'){if(!['Pending','Approved','Restored','Purged'].includes(query.status))fail('Invalid review status.',422,'validation_error');conditions.push('status=?');params.push(query.status);}
 const search=searchTerm(query.search);if(search){conditions.push("CONCAT_WS(' ',label,entity_id,entity_type,removed_name,reason) LIKE ?");params.push(search);}
 const where=conditions.length?'WHERE '+conditions.join(' AND '):'';
 return consistentRead(async c=>{const [[count]]=await c.execute('SELECT COUNT(*) total FROM catalog_removals '+where,params),meta=pageMeta(Number(count.total),query);
  const [rows]=await c.execute(`SELECT id,entity_type type,entity_id entityId,label,parent_id parentId,status,removed_name removedBy,terminal_slot terminal,reason,removed_at removedAt,reviewed_name reviewedBy,reviewed_at reviewedAt FROM catalog_removals ${where} ORDER BY removed_at DESC,id DESC LIMIT ${meta.size} OFFSET ${meta.offset}`,params);
  return {rows,...meta};
 });
}
export async function activityPage(query){
 const range=dateRange(query,'a.created_at'),search=searchTerm(query.search);
 if(search){range.clauses.push("CONCAT_WS(' ',a.action,a.entity_type,a.entity_id,a.actor_name,u.name,JSON_UNQUOTE(JSON_EXTRACT(a.after_json,'$.ticketNo')),JSON_UNQUOTE(JSON_EXTRACT(a.before_json,'$.ticketNo')),JSON_UNQUOTE(JSON_EXTRACT(a.after_json,'$.label'))) LIKE ?");range.params.push(search);}
 const where=range.clauses.length?'WHERE '+range.clauses.join(' AND '):'';
 const fields=['passenger','phone','seats','destination','boardingPoint','fare','discount','total','paid','bookingStatus','source','date','time','active','status','name','model','registration','from','to','boarding','service','busId','routeId','departure','days','platform','salesPaused','deleted','reason','review','label','commissionRate','commission','deductions','amount','staffName','terminal','notes','services','destinations','seatClasses','voucher','refundedTotal','role','remoteAllowed','terminals','mfaRequired','mfaConfigured','passwordChanged'];
 return consistentRead(async c=>{const [[count]]=await c.execute(`SELECT COUNT(*) total FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ${where}`,range.params),meta=pageMeta(Number(count.total),query);
  const [data]=await c.execute(`SELECT a.id,a.action,a.entity_type type,a.entity_id entityId,COALESCE(a.actor_name,u.name,'Not recorded') actor,a.terminal_slot terminal,a.created_at time,a.before_json,a.after_json FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT ${meta.size} OFFSET ${meta.offset}`,range.params);
  const rows=data.map(({before_json,after_json,...row})=>{const rawBefore=parseJson(before_json,{}),rawAfter=parseJson(after_json,{}),normalize=value=>({...value,voucher:value?.voucher||value?.snapshot?.voucher,refundedTotal:Array.isArray(value?.refunds)?value.refunds.reduce((sum,item)=>sum+Number(item.amount||0),0):undefined}),before=normalize(rawBefore),after=normalize(rawAfter),label=after.ticketNo||before.ticketNo||after.label||(after.from&&after.to?after.from+' → '+after.to:'')||after.name||before.name||after.model||before.model||row.entityId;return {...row,label,changes:fields.filter(key=>JSON.stringify(before?.[key])!==JSON.stringify(after?.[key])).map(field=>({field,before:before?.[field]??null,after:after?.[field]??null}))};});return {rows,...meta};
 });
}
export async function recoveryForEntity(type,id){const [[row]]=await pool.execute("SELECT id FROM catalog_removals WHERE entity_type=? AND entity_id=? AND status IN ('Pending','Approved') ORDER BY removed_at DESC,id DESC LIMIT 1",[type,id]);return row?.id;}
