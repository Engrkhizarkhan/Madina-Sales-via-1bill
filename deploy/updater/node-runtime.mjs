import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {atomicText} from './engine.mjs';
import {fetchBounded} from './release.mjs';
export const nodeRuntime=Object.freeze({version:'v22.23.5',name:'node-v22.23.5.exe',url:'https://nodejs.org/dist/v22.23.5/win-x64/node.exe',sha256:'247e9693d316da9857e44990e5e11709f596f18112251b8026ec6eed80bdf38a'});
export function verifyNodeRuntime(bytes){if(createHash('sha256').update(bytes).digest('hex')!==nodeRuntime.sha256)throw Error('The Node runtime checksum does not match the approved release.');return bytes;}
export function selectedNodeRuntime(base){const file=join(base,'runtime',nodeRuntime.name);return existsSync(file)?file:join(base,'runtime/node.exe');}
export async function packageNodeRuntime(application){
 const bytes=verifyNodeRuntime(await fetchBounded(nodeRuntime.url,120*1024*1024,{signal:AbortSignal.timeout(180000)}));
 await writeFile(join(application,'deploy/windows',nodeRuntime.name),bytes,{mode:0o644,flush:true});
}
export async function installNodeRuntime(base,application){
 const packaged=verifyNodeRuntime(await readFile(join(application,'deploy/windows',nodeRuntime.name)));
 const target=join(base,'runtime',nodeRuntime.name);
 if(existsSync(target))verifyNodeRuntime(await readFile(target));
 else{
  const temporary=target+'.stage';await rm(temporary,{force:true});
  try{await writeFile(temporary,packaged,{flag:'wx',mode:0o644,flush:true});await rename(temporary,target);}
  finally{await rm(temporary,{force:true});}
 }
 // These protected launchers select the versioned executable. The running
 // updater keeps its current executable until its next scheduled launch.
 for(const file of ['Run-Server.ps1','Run-Updater.ps1'])await atomicText(join(base,'host',file),await readFile(join(application,'deploy/windows',file),'utf8'));
 return target;
}
