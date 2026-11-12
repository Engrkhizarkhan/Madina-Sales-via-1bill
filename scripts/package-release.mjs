import { cp,mkdir,mkdtemp,readFile,writeFile,readdir,rm } from 'node:fs/promises';
import { createPrivateKey,sign,createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve,join } from 'node:path';
import { tmpdir } from 'node:os';
const out=resolve('.release');await mkdir(out,{recursive:true});
const build=JSON.parse(await readFile('build-info.json','utf8'));
if(!/^[a-f0-9]{40}$/.test(build.commit)||build.sequence<1)throw new Error('Build a numbered release first');
const trackedChanges=execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim();
if(trackedChanges)throw new Error('Commit application changes before packaging a release');
const migrations=[];
for(const name of (await readdir('backend/database/migrations')).filter(name=>name.endsWith('.sql')).sort()){
 const sql=await readFile(join('backend/database/migrations',name),'utf8');
 if(Number(name.split('_')[0])>=12&&(!sql.includes('-- release: additive')||/\b(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE\s+|RENAME\s+TABLE)\b/i.test(sql)))throw new Error('Automatic releases require reviewed additive migrations: '+name);
 migrations.push({name,sha256:createHash('sha256').update(sql).digest('hex')});
}
const childEnvironment={...process.env};delete childEnvironment.RELEASE_SIGNING_KEY_BASE64;
const stage=await mkdtemp(join(tmpdir(),'madina-release-'));
try{
 for(const file of ['package.json','package-lock.json','build-info.json'])await cp(file,join(stage,file));
 for(const directory of ['backend/node','backend/terminal','backend/update','backend/database','shared','dist','deploy'])await cp(directory,join(stage,directory),{recursive:true,filter:source=>!/(?:^|[\\/])(?:\.env[^\\/]*|\.terminal|\.cloud-sessions|\.updates|__pycache__)(?:[\\/]|$)/.test(source)});
 execFileSync(process.platform==='win32'?'npm.cmd':'npm',['ci','--omit=dev','--ignore-scripts'],{cwd:stage,env:childEnvironment,stdio:'inherit'});
 execFileSync(process.execPath,['--input-type=module','-e','await import("./backend/node/app.js"); const {pool}=await import("./backend/node/db.js"); await pool.end();'],{cwd:stage,env:{...childEnvironment,MADINA_ENV_FILE:join(stage,'absent.env'),DB_NAME:'package_import_qa',DB_USER:'qa',DB_PASSWORD:'unused',TERMINAL_ROLE:'standalone',ADMIN_TOTP_HEX:'',RESTRICT_STAFF_DEVICES:'false',ADMIN_TOTP_PAUSED:'false'},stdio:'inherit'});
 const file=build.releaseId+'.zip' ,destination=join(out,file);
 execFileSync('zip',['-q','-r',destination,'.'],{cwd:stage});
 const bytes=await readFile(destination),now=Date.now();
 const release={project:'madina-express',...build,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+90*86400000).toISOString(),file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),schemaBackwardsCompatible:true,migrations};
 const key=process.env.RELEASE_SIGNING_KEY_BASE64;if(!key)throw new Error('The protected release signing key is missing');
 const payload=JSON.stringify(release),signature=sign(null,Buffer.from(payload),createPrivateKey(Buffer.from(key,'base64'))).toString('base64');
 await writeFile(join(out,'channel.json'),JSON.stringify({payload,signature}));
 console.log('Signed '+release.releaseId+' ('+bytes.length+' bytes)');
}finally{await rm(stage,{recursive:true,force:true});}
