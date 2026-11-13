import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,writeFile,unlink,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory=await mkdtemp(join(tmpdir(),"madina-cloud-authority-"));
Object.assign(process.env,{TERMINAL_ROLE:"cloud",TERMINAL_DIRECTORY:directory,DB_NAME:"authority_qa",DB_USER:"qa",DB_PASSWORD:"unused"});
const {terminalState,cloudNeedsMain,cloudAuthorityGuard}=await import("../terminal/state.js");
const guard=path=>new Promise(resolve=>cloudAuthorityGuard({method:"POST",path},{},error=>resolve(error)));
test("public writes stay closed throughout a new-main-PC handover",async()=>{
  try {
    for(const phase of ["awaiting-main","provisioned","preparing","active"]){
      await writeFile(join(directory,"state.json"),JSON.stringify({phase}));
      assert.equal(cloudNeedsMain(await terminalState()),true);
      assert.equal((await guard("/public/bookings")).code,"terminal_unavailable");
      assert.equal(await guard("/auth/login"),undefined);
      assert.equal(await guard("/terminal/package"),undefined);
    }
    await writeFile(join(directory,"state.json"),JSON.stringify({phase:"standalone"}));
    assert.equal(cloudNeedsMain(await terminalState()),false);
    await writeFile(join(directory,"require-main.json"),"{}");
    assert.equal((await guard("/public/bookings")).code,"terminal_unavailable");
    await unlink(join(directory,"state.json"));
    assert.equal((await guard("/public/bookings")).code,"terminal_unavailable","a missing state file cannot bypass the persistent require-main fence");
  } finally {await rm(directory,{recursive:true,force:true});}
});
