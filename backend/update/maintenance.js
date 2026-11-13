import { existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../node/config.js';
let active = 0, lastWrite = Date.now(), drainUntil = process.env.UPDATE_JOURNAL_PATH && existsSync(process.env.UPDATE_JOURNAL_PATH) ? Date.now()+300000 : 0;
export const maintenance = {
 beginOwnerMaintenance(allowedWrites = 1) {
  if (active > allowedWrites || Date.now() < drainUntil) return false;
  drainUntil=Date.now()+300000;return true;
 },
 endOwnerMaintenance() { drainUntil=0;lastWrite=Date.now(); },
 status: () => ({ activeWrites:active, quietSeconds:Math.floor((Date.now()-lastWrite)/1000), draining:Date.now()<drainUntil }),
 draining: () => Date.now()<drainUntil,
 middleware(req,res,next) {
  const write = !['GET','HEAD','OPTIONS'].includes(req.method) && /^\/(?:bookings|public\/bookings|trips|buses|routes|crew|users|expenses|finance|settings)(?:\/|$)/.test(req.path);
  if (!write) return next();
  if (Date.now()<drainUntil) return res.status(503).json({error:{code:'updating',message:'A system update is being installed. Wait a moment, refresh and try again.'}});
  active++;lastWrite=Date.now();let finished=false;
  const finish=()=>{if(!finished){finished=true;active--;lastWrite=Date.now();}};
  res.once('finish',finish);res.once('close',finish);next();
 },
 route(req,res,next) {
  if (!req.path.startsWith('/internal-update/')) return next();
  const actual=req.get('X-Madina-Updater-Key')||'', expected=process.env.UPDATE_CONTROL_KEY||'';
  if (!['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress) || !expected || actual.length!==expected.length || !timingSafeEqual(Buffer.from(actual),Buffer.from(expected))) return res.status(403).json({error:{code:'forbidden',message:'Local updater access is required.'}});
  if(req.method==='GET'&&req.path==='/internal-update/status')return res.json(maintenance.status());
  if(req.method==='POST'&&req.path==='/internal-update/drain'){
   if(active||Date.now()-lastWrite<60000)return res.status(409).json({error:{code:'busy',message:'Counter operations are still in progress.'}});
   drainUntil=Date.now()+300000;return res.json({draining:true});
  }
  if(req.method==='POST'&&req.path==='/internal-update/resume'){drainUntil=0;return res.json({draining:false});}
  return res.sendStatus(404);
 }
};
