import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createPrivateKey,sign,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {zipSync,unzipSync} from 'fflate';
import {verifyRelease,verifyPackage,zipEntries,fetchBounded,maxPackageBytes} from '../deploy/updater/release.mjs';
import {releaseTreeHash} from '../deploy/updater/materialize-bridge.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const build=JSON.parse(await readFile('build-info.json','utf8'));
const baseId=process.env.DOMAIN_BRIDGE_BASE;
if(!/^r-[a-f0-9]{12,40}$/.test(baseId||'')||!Number.isSafeInteger(build.sequence)||build.sequence<1)throw new Error('Choose the exact accepted base release.');
const url='https://github.com/Engrkhizarkhan/Madina-Sales-via-1bill/releases/download/'+baseId+'/';
const key=await readFile('deploy/updater/release-public-key.pem','utf8');
const base=verifyRelease(JSON.parse((await fetchBounded(url+'channel.json',65536,{redirect:'follow'})).toString()),key);
if(base.releaseId!==baseId||base.sequence>=build.sequence||base.packageKind==='domain-bridge')throw new Error('Invalid bridge base sequence.');
const bytes=await fetchBounded(url+base.file,maxPackageBytes,{redirect:'follow'});verifyPackage(bytes,base);zipEntries(bytes);
const original=unzipSync(bytes),entries={};
for(const name of ['package.json','backend/node/server.js','dist/index.html'])entries[name]=original[name];
// Older agents copy dist/assets before invoking migrations. One unchanged,
// already verified small asset creates that directory without shipping fonts.
const asset=Object.keys(original).filter(name=>name.startsWith('dist/assets/')&&/\.(js|css)$/.test(name)).sort((a,b)=>original[a].length-original[b].length)[0];
if(!asset)throw new Error('The accepted base has no frontend assets.');
entries[asset]=original[asset];
entries['build-info.json']=Buffer.from(JSON.stringify(build));
// No schema or sales operation is performed by this configuration-only bridge.
entries['backend/update/migrate-release.mjs']=Buffer.from(`import {resolve,join} from 'node:path';
import {materializeBridge} from '../../deploy/updater/materialize-bridge.mjs';
await materializeBridge(resolve('.'));
if(process.platform==='win32'){
 const {migrateCloudDomain}=await import('../../deploy/updater/domain-migration.mjs');
 await migrateCloudDomain(join(process.env.ProgramData||'C:\\\\ProgramData','MadinaExpress'));
}
`);
entries['shared/domains.mjs']=await readFile('shared/domains.mjs');
// Keep the current updater/fallback and dual-domain installer/proxy support.
const childEnvironment={...process.env};delete childEnvironment.RELEASE_SIGNING_KEY_BASE64;
for(const name of execFileSync('git',['ls-files','-z','deploy'],{encoding:'utf8',env:childEnvironment}).split('\0').filter(Boolean)){
 if(!name.split('/').some(part=>part.startsWith('.env')||part==='__pycache__'))entries[name]=await readFile(name);
}
entries['deploy/updater/materialize-bridge.mjs']=await readFile('deploy/updater/materialize-bridge.mjs');
const migrations=[];
for(const name of (await readdir('backend/database/migrations')).filter(name=>name.endsWith('.sql')).sort())migrations.push({name,sha256:hash(await readFile('backend/database/migrations/'+name))});
if(JSON.stringify(migrations)!==JSON.stringify(base.migrations))throw new Error('A domain bridge cannot change the database schema.');
const metadata={project:'madina-express',kind:'domain-bridge',baseReleaseId:baseId,baseSha256:base.sha256,baseTreeSha256:releaseTreeHash(original),overlay:Object.entries(entries).map(([path,value])=>({path,sha256:hash(value)}))};
entries['domain-bridge.json']=Buffer.from(JSON.stringify(metadata));
const archive=zipSync(entries,{level:9});zipEntries(Buffer.from(archive));
if(archive.length>150000)throw new Error('The configuration bridge is too large for the constrained connection.');
const now=Date.now(),file=build.releaseId+'.zip';
const release={project:'madina-express',...build,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+90*86400000).toISOString(),file,bytes:archive.length,sha256:hash(archive),schemaBackwardsCompatible:true,migrations,packageKind:'domain-bridge',baseReleaseId:baseId};
const signingKey=process.env.RELEASE_SIGNING_KEY_BASE64;if(!signingKey)throw new Error('The protected release signing key is missing');
const payload=JSON.stringify(release),signature=sign(null,Buffer.from(payload),createPrivateKey(Buffer.from(signingKey,'base64'))).toString('base64');
await mkdir('.release',{recursive:true});await writeFile('.release/'+file,archive);await writeFile('.release/channel.json',JSON.stringify({payload,signature}));
console.log('Signed configuration-only bridge ('+archive.length+' bytes), exact base '+baseId+'. No live system was contacted.');
