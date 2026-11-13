import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { config } from '../node/config.js';
import { pool } from '../node/db.js';
import { createStaffUser,updateStaffUser,removeStaffUser } from '../node/operations.js';
if(!/test|qa/i.test(config.db.database))throw new Error('Use an isolated test database.');
const suffix=randomBytes(5).toString('hex'),ids=[],req={ip:'127.0.0.1'},strong='StaffAccount!2026Only';
const draft=(username,extra={})=>({name:'Staff account QA',username,role:'counter',password:'1234',remoteAllowed:false,terminals:[1],...extra});
const expectCode=(operation,code)=>assert.rejects(operation,error=>error.code===code);
let owner;
async function create(data){const account=await createStaffUser(data,owner,req);ids.push(account.id);return account;}
async function row(id){return (await pool.execute('SELECT * FROM users WHERE id=?',[id]))[0][0];}
try{
 const [actor]=await pool.execute("INSERT INTO users(name,username,password_hash,role,is_owner,remote_allowed,force_password_change) VALUES (?,?,?,'admin',1,1,0)",['Staff QA owner','account-owner-'+suffix,await bcrypt.hash(strong,4)]);
 owner={id:actor.insertId,role:'admin',is_owner:1};ids.push(owner.id);
 const username='reuse-'+suffix,email='reuse-'+suffix+'@example.invalid';
 const [legacy]=await pool.execute("INSERT INTO users(name,username,email,password_hash,role,active,mfa_required,mfa_secret,remote_allowed) VALUES (?,?,?,?,'counter',0,1,'obsolete-secret',1)",['Historical employee',username,email,await bcrypt.hash(strong,4)]);
 ids.push(legacy.insertId);
 await pool.execute("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,ip_address) VALUES (?,'qa.history','user',?,'127.0.0.1')",[legacy.insertId,String(legacy.insertId)]);
 await pool.execute("INSERT INTO api_sessions(token_hash,user_id,csrf_token,last_activity,expires_at,ip_address,user_agent) VALUES (?,?,?,NOW(),DATE_ADD(NOW(),INTERVAL 1 HOUR),'127.0.0.1','Isolated QA')",[randomBytes(32).toString('hex'),legacy.insertId,randomBytes(32).toString('hex')]);
 const reused=await create(draft(username.toUpperCase(),{email}));
 assert.notEqual(reused.id,legacy.insertId);assert.equal(reused.username,username);assert.equal(reused.remoteAllowed,false);assert.equal(reused.mfaRequired,false);
 assert.equal(await bcrypt.compare('1234',(await row(reused.id)).password_hash),true);
 const old=await row(legacy.insertId);assert.equal(old.active,0);assert.notEqual(old.username,username);assert.equal(old.email,null);assert.equal(old.mfa_secret,null);assert.equal(old.name,'Historical employee');
 assert.equal((await pool.execute("SELECT COUNT(*) count FROM audit_logs WHERE user_id=? AND action='qa.history'",[legacy.insertId]))[0][0].count,1);
 assert.equal((await pool.execute('SELECT COUNT(*) count FROM api_sessions WHERE user_id=?',[legacy.insertId]))[0][0].count,0);
 console.log('PASS deleted legacy username is reused with a fresh ID, terminal PIN and no old access; historical references remain intact');
 await expectCode(()=>create(draft(username.toUpperCase())),'duplicate_username');
 await expectCode(()=>create(draft('email-collision-'+suffix,{email})),'duplicate_email');
 const blank=await create(draft('blank-one-'+suffix));await create(draft('blank-two-'+suffix));
 assert.equal((await row(blank.id)).email,null);
 await expectCode(()=>updateStaffUser(String(blank.id),draft(username),owner,req),'duplicate_username');
 await expectCode(()=>updateStaffUser(String(blank.id),draft(blank.username,{email}),owner,req),'duplicate_email');
 console.log('PASS active username/email collisions have specific errors; several accounts can omit email');
 await expectCode(()=>create(draft('remote-short-'+suffix,{remoteAllowed:true})),'weak_password');
 await expectCode(()=>create(draft('too-short-'+suffix,{password:'123'})),'weak_password');
 await expectCode(()=>updateStaffUser(String(reused.id),draft(username,{email,password:'',remoteAllowed:true}),owner,req),'remote_password_required');
 await expectCode(()=>updateStaffUser(String(reused.id),draft(username,{email,password:'1234',remoteAllowed:true}),owner,req),'weak_password');
 const remote=await updateStaffUser(String(reused.id),draft(username,{email,password:strong,remoteAllowed:true}),owner,req);assert.equal(remote.remoteAllowed,true);
 await expectCode(()=>updateStaffUser(String(reused.id),draft(username,{email,password:'1234',remoteAllowed:true}),owner,req),'weak_password');
 await updateStaffUser(String(reused.id),draft(username,{email,password:'4321'}),owner,req);
 await expectCode(()=>updateStaffUser(String(reused.id),draft(username,{email,password:'',remoteAllowed:true}),owner,req),'remote_password_required');
 await expectCode(()=>updateStaffUser(String(owner.id),draft('account-owner-'+suffix),owner,req),'admin_protected');
 console.log('PASS terminal PINs cannot become remote passwords and cannot weaken the main administrator');
 await removeStaffUser(String(reused.id),owner,req);
 const fresh=await create(draft(username,{email}));assert.notEqual(fresh.id,reused.id);assert.equal((await row(reused.id)).active,0);assert.equal(await bcrypt.compare('4321',(await row(fresh.id)).password_hash),false);
 assert.equal((await row(legacy.insertId)).active,0);
 console.log('PASS deleting and recreating an account never reactivates an old employee or inherits their credentials');
 const racers=await Promise.allSettled([create(draft('race-'+suffix)),create(draft('race-'+suffix))]);
 assert.equal(racers.filter(value=>value.status==='fulfilled').length,1);
 assert.equal(racers.find(value=>value.status==='rejected').reason.code,'duplicate_username');
 console.log('PASS simultaneous account creation yields one account and a specific duplicate-username error');
}finally{
 for(const id of ids){await pool.execute('DELETE FROM audit_logs WHERE user_id=?',[id]);await pool.execute('DELETE FROM api_sessions WHERE user_id=?',[id]);}
 for(const id of ids)await pool.execute('DELETE FROM users WHERE id=?',[id]);
 await pool.end();
}
