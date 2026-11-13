import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync,sign } from "node:crypto";
import { verifyOwnerCommand,applyOwnerCommand } from "../terminal/owner-command.js";
const keys=generateKeyPairSync("ed25519"),now=Date.now();
const context={installationId:"test-main-pc",releaseId:"r-test-release",now};
const command={project:"madina-express",action:"clear-test-data",installationId:context.installationId,releaseId:context.releaseId,nonce:"ab".repeat(16),ownerId:1,expiresAt:now+600000};
const signed=data=>{const payload=JSON.stringify(data);return {payload,signature:sign(null,Buffer.from(payload),keys.privateKey).toString("base64")};};
test("maintenance accepts only operator-signed requests for the exact PC and release",()=>{
  assert.deepEqual(verifyOwnerCommand(signed(command),keys.publicKey,context),command);
  for(const changed of [{action:"run-sql"},{installationId:"another-pc"},{releaseId:"previous-release"},{expiresAt:now-1},{expiresAt:now+3600000},{nonce:"../path"},{ownerId:0}])assert.throws(()=>verifyOwnerCommand(signed({...command,...changed}),keys.publicKey,context));
  const tampered=signed(command);tampered.payload=tampered.payload.replace('clear-test-data','run-sql');assert.throws(()=>verifyOwnerCommand(tampered,keys.publicKey,context));
  assert.throws(()=>verifyOwnerCommand(signed(command),generateKeyPairSync("ed25519").publicKey,context));
});
test("maintenance waits for quiet counters and always releases its write fence",async()=>{
  let executions=0,released=0;
  const options={...context,key:keys.publicKey,begin:()=>false,end:()=>released++,loadOwner:async()=>({role:"admin",is_owner:1,active:1}),execute:async()=>{executions++;return {cleared:{bookings:3}};}};
  assert.equal((await applyOwnerCommand(signed(command),options)).stage,"waiting");assert.equal(executions,0);assert.equal(released,0);
  const applied=await applyOwnerCommand(signed(command),{...options,begin:()=>true});assert.equal(applied.stage,"applied");assert.equal(executions,1);assert.equal(released,1);
  await assert.rejects(()=>applyOwnerCommand(signed(command),{...options,begin:()=>true,loadOwner:async()=>({role:"counter",active:1})}));assert.equal(released,2);assert.equal(executions,1);
});
