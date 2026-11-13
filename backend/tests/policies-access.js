import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
Object.assign(process.env,{DB_NAME:'account_unit_qa',DB_USER:'qa',DB_PASSWORD:'unused',TERMINAL_ROLE:'standalone',RESTRICT_STAFF_DEVICES:'true',ADMIN_TOTP_HEX:'ac'.repeat(20)});
const { isOwner,canRemote,permittedDevice,accessDetails,newAuthenticator,verifyUserCode }=await import('../node/account-access.js');
const { defaultPolicies,validatePolicies,reservationExpiry,staffCollectionPolicy,staffRefundPolicy }=await import('../node/policies.js');
const counter={role:'counter',is_owner:0,remote_allowed:0,terminal_slots:[2]};
const owner={role:'admin',is_owner:1,remote_allowed:0};
function decode32(value){let bits=0,number=0;const out=[];for(const char of value){number=(number<<5)|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);bits+=5;if(bits>=8){bits-=8;out.push((number>>>bits)&255);}}return Buffer.from(out);}
function code(secret){const buffer=Buffer.alloc(8);buffer.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const hash=createHmac('sha1',decode32(secret)).update(buffer).digest(),offset=hash.at(-1)&15;return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');}
test('owner is remote, while sub-admin status alone never bypasses enrolled devices',()=>{
 assert.ok(isOwner(owner));assert.ok(canRemote(owner));assert.ok(permittedDevice(owner,''));
 assert.equal(permittedDevice({...counter,role:'admin'},''),false);
 assert.equal(permittedDevice(counter,'terminal-1:certificate'),false);
 assert.equal(permittedDevice(counter,'terminal-2:certificate'),true);
 assert.equal(permittedDevice(counter,''),false);
 assert.equal(permittedDevice({...counter,remote_allowed:1},''),true);
});
test('account access validates terminal slots and optional email',()=>{
 assert.deepEqual(accessDetails({terminals:[2,2],email:'Staff@Example.COM'}),{remote:false,terminals:[2],email:'staff@example.com'});
 assert.throws(()=>accessDetails({terminals:[]}),error=>error.status===422);
 assert.throws(()=>accessDetails({terminals:[100]}),error=>error.status===422);
 assert.throws(()=>accessDetails({remoteAllowed:'true'}),error=>error.status===422);
 assert.deepEqual(accessDetails({remoteAllowed:true,terminals:[]}).terminals,[]);
});
test('per-account authenticators are encrypted and reject invalid or replayed codes',()=>{
 const setup=newAuthenticator('subadmin');assert.ok(!setup.encrypted.includes(setup.secret));
 const user={mfa_required:1,mfa_secret:setup.encrypted,mfa_last_step:-1};
 assert.equal(verifyUserCode(user,'invalid'),false);
 const step=verifyUserCode(user,code(setup.secret));assert.equal(typeof step,'number');
 assert.equal(verifyUserCode({...user,mfa_last_step:step},code(setup.secret)),false);
 assert.equal(verifyUserCode({mfa_required:0},''),null);
});
test('reservation expiry follows selected hours and departure, or can be disabled',()=>{
 const now=Date.parse('2026-11-13T10:00:00+05:00'),departure=now+10*3600000;
 assert.equal(reservationExpiry(defaultPolicies,true,departure,now).getTime(),now+2*3600000);
 assert.equal(reservationExpiry({...defaultPolicies,publicExpiryHours:3},true,departure,now).getTime(),now+3*3600000);
 assert.equal(reservationExpiry({...defaultPolicies,publicExpiryHours:20},true,departure,now).getTime(),departure);
 assert.equal(reservationExpiry({...defaultPolicies,publicExpiryEnabled:false},true,departure,now),null);
 assert.equal(reservationExpiry(defaultPolicies,false,departure,now),null);
 assert.equal(reservationExpiry({...defaultPolicies,staffExpiryEnabled:true,staffExpiryHours:1},false,departure,now).getTime(),now+3600000);
});
test('policy validation rejects invalid flags, expiry and percentages',()=>{
 for(const data of [{publicExpiryHours:0},{staffCanRefund:'yes'},{staffMaxRefundPercent:101},{publicMaxSeats:1.5},{publicAdvanceDays:1000}])assert.throws(()=>validatePolicies(data),error=>error.status===422);
 assert.equal(validatePolicies({publicExpiryHours:.5}).publicExpiryHours,.5);
});
test('staff fare, discount, collection and cumulative refund limits are enforced',()=>{
 const policy={...defaultPolicies,staffCanEditFare:false,staffMaxDiscountPercent:10,staffMaxCollection:5000,staffMaxRefundPercent:50,staffMaxRefundAmount:1000};
 assert.throws(()=>staffCollectionPolicy(policy,counter,[2200],[2250],0),error=>error.status===403);
 assert.throws(()=>staffCollectionPolicy(policy,counter,[2200],[2200],221),error=>error.status===403);
 assert.throws(()=>staffCollectionPolicy(policy,counter,[6000],[6000],0),error=>error.status===403);
 assert.doesNotThrow(()=>staffCollectionPolicy(policy,counter,[2200],[2200],220));
 assert.throws(()=>staffRefundPolicy(policy,counter,1001,5000,0),error=>error.status===403);
 assert.throws(()=>staffRefundPolicy(policy,counter,600,2200,600),error=>error.status===403);
 assert.doesNotThrow(()=>staffRefundPolicy(policy,counter,500,2200,600));
 assert.doesNotThrow(()=>staffRefundPolicy(policy,owner,2200,2200,0));
 assert.throws(()=>staffRefundPolicy({...policy,staffCanRefund:false},counter,1,2200,0),error=>error.status===403);
});

test('expanded PC access remains explicitly assigned and rejects malformed slots',()=>{
 assert.equal(permittedDevice({...counter,terminal_slots:[4]},'terminal-4:certificate'),true);
 assert.equal(permittedDevice(counter,'terminal-4:certificate'),false);
 assert.deepEqual(accessDetails({terminals:[4,12,99],remoteAllowed:false}).terminals,[4,12,99]);
 for(const slot of [0,100,1.5,'4'])assert.throws(()=>accessDetails({terminals:[slot],remoteAllowed:false}));
});
