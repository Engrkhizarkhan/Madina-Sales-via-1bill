import {Router} from 'express';
import {randomBytes} from 'node:crypto';
import {config} from '../node/config.js';
import {pool} from '../node/db.js';
import {fail,isoDateTime} from '../node/helpers.js';
import {requireOwner} from '../node/account-access.js';
import {presenceSummary,qualityBars} from '../../shared/terminal-presence.mjs';
const route=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const sample=randomBytes(96*1024);
let lastCleanup=0;
function enrolled(req){
  if(config.terminal.cloud)fail('The main PC is temporarily unavailable. Connection reporting will retry.',503,'terminal_unavailable');
  if(!config.terminal.local)fail('The main PC records terminal connections.',403,'terminal_required');
  const match=req.verifiedTerminal?.match(/^terminal-([1-9][0-9]?):([a-f0-9]{64})$/);
  if(!match)fail('An enrolled PC is required.',403,'terminal_required');
  return {slot:Number(match[1]),fingerprint:match[2]};
}
const metric=(value,max)=>value===null||value===undefined?null:typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max?value:fail('Invalid connection measurement.',422,'validation_error');
export const terminalPresenceRouter=Router();
terminalPresenceRouter.get('/probe',route(async(req,res)=>{
  enrolled(req);res.type('application/octet-stream').set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).send(sample);
}));
terminalPresenceRouter.post('/heartbeat',route(async(req,res)=>{
  const device=enrolled(req),body=req.body;
  if(!body||!/^[a-f0-9]{32}$/.test(body.instance)||!['opening','ready'].includes(body.phase)||typeof body.version!=='string'||!/^[a-zA-Z0-9.+-]{0,24}$/.test(body.version)||![true,false,null,undefined].includes(body.probeOk))fail('Invalid PC contact.',422,'validation_error');
  const transport=req.socket.encrypted?'lan':'online';
  const metrics=[metric(body.rttMs,3600000),metric(body.downloadMbps,1000000),metric(body.lossPct,100),body.probeOk==null?null:Number(body.probeOk)];
  // A bounded set of tabs per enrolled PC. Browser contacts never count as
  // business writes and therefore cannot prevent a quiet application update.
  await pool.execute('DELETE FROM terminal_presence WHERE slot=? AND last_seen<DATE_SUB(NOW(3),INTERVAL 1 DAY)',[device.slot]);
  const [[count]]=await pool.execute('SELECT COUNT(*) n FROM terminal_presence WHERE slot=? AND instance_id<>?',[device.slot,body.instance]);
  if(Number(count.n)>=16){
    await pool.execute('DELETE FROM terminal_presence WHERE slot=? ORDER BY last_seen LIMIT 1',[device.slot]);
  }
  await pool.execute(`INSERT INTO terminal_presence(slot,fingerprint,instance_id,last_seen,phase,transport,rtt_ms,download_mbps,loss_pct,probe_ok,version)
    VALUES(?,?,?,NOW(3),?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE fingerprint=VALUES(fingerprint),last_seen=NOW(3),phase=VALUES(phase),transport=VALUES(transport),rtt_ms=VALUES(rtt_ms),download_mbps=VALUES(download_mbps),loss_pct=VALUES(loss_pct),probe_ok=VALUES(probe_ok),version=VALUES(version)`,
    [device.slot,device.fingerprint,body.instance,body.phase,transport,...metrics,body.version]);
  if(Date.now()-lastCleanup>3600000){lastCleanup=Date.now();await pool.execute('DELETE p FROM terminal_presence p JOIN terminal_presence newer ON newer.slot=p.slot AND newer.last_seen>p.last_seen WHERE p.last_seen<DATE_SUB(NOW(3),INTERVAL 1 DAY)');}
  res.json({ok:true});
}));
export async function terminalPresence(req,res){
  requireOwner(req.user);
  const [devices]=await pool.query('SELECT s.slot,d.fingerprint,d.expires_at>NOW() enrolled FROM terminal_slots s LEFT JOIN terminal_devices d ON d.slot=s.slot ORDER BY s.slot');
  const [contacts]=await pool.query('SELECT *,GREATEST(0,TIMESTAMPDIFF(MICROSECOND,last_seen,NOW(3))/1000) ageMs FROM terminal_presence');
  const sourceReachable=!req.cloudReadOnly;
  res.json({sourceReachable,checkedAt:new Date().toISOString(),terminals:devices.map(device=>{
    const rows=contacts.filter(row=>Number(row.slot)===Number(device.slot)&&row.fingerprint===device.fingerprint).map(row=>({...row,ageMs:Number(row.ageMs),lastSeen:isoDateTime(row.last_seen)}));
    const summary=presenceSummary(rows,sourceReachable,Boolean(device.enrolled));
    return {slot:Number(device.slot),enrolled:Boolean(device.enrolled),...summary,bars:qualityBars(summary)};
  })});
}
