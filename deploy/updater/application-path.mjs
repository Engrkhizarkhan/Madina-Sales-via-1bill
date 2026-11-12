import { readFile,realpath,access } from 'node:fs/promises';
import { resolve,join,relative,isAbsolute } from 'node:path';
export async function selectedApplication(pointer='/var/lib/madina-express/host/current.json',allowed=['/opt/madina-express','/var/lib/madina-express/releases']){
 const record=JSON.parse(await readFile(pointer,'utf8'));
 if(typeof record.application!=='string')throw new Error('The application pointer is invalid');
 const application=await realpath(resolve(record.application));
 const roots=await Promise.all(allowed.map(root=>realpath(resolve(root)).catch(()=>resolve(root))));
 if(!roots.some(root=>{const path=relative(root,application);return !isAbsolute(path)&&path!== '..'&&!path.startsWith('..'+(process.platform==='win32'?'\\':'/'));}))throw new Error('The application path is outside the managed release directory');
 await access(join(application,'backend/node/server.js'));
 return application;
}
