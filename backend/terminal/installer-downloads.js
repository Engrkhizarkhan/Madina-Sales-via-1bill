import {constants} from 'node:fs';
import {copyFile,mkdir,mkdtemp,writeFile,readFile,chmod,readdir,stat,rm,rename} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {config} from '../node/config.js';
import {fail} from '../node/helpers.js';
import {runProcess} from './process.js';

export const installerDownloadLifetime=30*60000;
export const installerDirectory=()=>process.env.TERMINAL_INSTALLER_DIRECTORY||join(config.terminal.directory,'installer-downloads');
const validId=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
const files=['Install-Main-PC.ps1','Install-Main-PC.cmd','runtime.json','Change-Main-PC-Network.cmd','Change-Main-PC-Network.ps1','Change-Terminal-PC-Address.cmd','Change-Terminal-PC-Address.ps1'];

export async function buildMainInstaller(setup,{project=resolve('.'),baseArchive=join(config.terminal.directory,'base.zip')}={}) {
  const directory=await mkdtemp(join(tmpdir(),'madina-installer-'));
  const dispose=()=>rm(directory,{recursive:true,force:true});
  try {
    await copyFile(baseArchive,join(directory,'application.zip'));
    for(const name of files)await copyFile(join(project,'deploy/windows',name),join(directory,name));
    await writeFile(join(directory,'setup.json'),JSON.stringify({token:setup.installToken,knownHost:setup.knownHost,cloudOrigin:'https://staff.madinaexpress.duckdns.org'}),{mode:0o600});
    const file=join(directory,'main-pc.zip');
    await runProcess('zip',['-0','-q',file,'application.zip',...files,'setup.json'],{cwd:directory});
    return {file,dispose};
  }catch(error){await dispose();throw error;}
}

async function removeGrant(directory,id){
  await Promise.all([rm(join(directory,id+'.json'),{force:true}),rm(join(directory,id+'.json.next'),{force:true}),rm(join(directory,id+'.zip'),{force:true})]);
}

export async function pruneInstallerDownloads(directory=installerDirectory(),now=Date.now()) {
  let names;
  try{names=await readdir(directory);}catch(error){if(error.code==='ENOENT')return;throw error;}
  for(const name of names){
    if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
    try{
      const grant=JSON.parse(await readFile(join(directory,name),'utf8'));
      if(Number.isFinite(grant.expiresAt)&&grant.expiresAt<=now)await removeGrant(directory,name.slice(0,-5));
    }catch(error){
      if(error instanceof SyntaxError){
        try{if((await stat(join(directory,name))).mtimeMs<now-installerDownloadLifetime)await removeGrant(directory,name.slice(0,-5));}catch(cleanupError){if(cleanupError.code!=='ENOENT')throw cleanupError;}
      }
      else if(error.code!=='ENOENT')throw error;
    }
  }
  // A process interruption between ZIP copy and metadata publication can leave
  // an orphan. Never remove a recent/in-progress archive or unrelated files.
  for(const name of names){
    if(/^[a-f0-9]{64}\.json\.next$/.test(name)){
      try{if((await stat(join(directory,name))).mtimeMs<now-installerDownloadLifetime)await rm(join(directory,name),{force:true});}catch(error){if(error.code!=='ENOENT')throw error;}
      continue;
    }
    if(!/^[a-f0-9]{64}\.zip$/.test(name))continue;
    try{
      const file=join(directory,name),metadata=join(directory,name.slice(0,-4)+'.json');
      if((await stat(file)).mtimeMs>now-installerDownloadLifetime)continue;
      try{await stat(metadata);}catch(error){if(error.code==='ENOENT')await rm(file,{force:true});else throw error;}
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
}

export async function createInstallerDownload(file,userId,sessionHash,{directory=installerDirectory(),now=Date.now()}={}) {
  if(!Number.isSafeInteger(Number(userId))||Number(userId)<1||!validId(sessionHash))throw new Error('A signed-in administrator session is required.');
  await mkdir(directory,{recursive:true,mode:0o700});
  await pruneInstallerDownloads(directory,now);
  const id=randomBytes(32).toString('hex'),destination=join(directory,id+'.zip');
  try{
    await copyFile(file,destination,constants.COPYFILE_EXCL);
    // The dedicated production directory inherits the nginx read-only group.
    // Authorization metadata remains private to the app account.
    await chmod(destination,0o640);
    const grant={userId:Number(userId),sessionHash,createdAt:now,expiresAt:now+installerDownloadLifetime};
    await writeFile(join(directory,id+'.json.next'),JSON.stringify(grant),{mode:0o600,flag:'wx'});
    await rename(join(directory,id+'.json.next'),join(directory,id+'.json'));
    const own=[];
    for(const name of await readdir(directory)){
      if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
      let value;
      try{value=JSON.parse(await readFile(join(directory,name),'utf8'));}catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)continue;throw error;}
      if(value.userId===Number(userId))own.push({id:name.slice(0,-5),createdAt:value.createdAt});
    }
    own.sort((a,b)=>a.id===id?-1:b.id===id?1:b.createdAt-a.createdAt||a.id.localeCompare(b.id));
    for(const previous of own.slice(5))await removeGrant(directory,previous.id);
    return {downloadPath:'/terminal/installer-download/'+id,expiresAt:grant.expiresAt};
  }catch(error){await removeGrant(directory,id);throw error;}
}

export async function installerDownload(id,userId,sessionHash,{directory=installerDirectory(),now=Date.now()}={}) {
  if(!validId(id))fail('Prepare a new main PC download in Settings.',404,'download_unavailable');
  let grant;
  try{grant=JSON.parse(await readFile(join(directory,id+'.json'),'utf8'));}
  catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)fail('This installer download expired. Prepare it again in Settings.',410,'download_expired');throw error;}
  if(grant.userId!==Number(userId)||!validId(sessionHash)||grant.sessionHash!==sessionHash)fail('Use the same signed-in browser that prepared this installer.',403,'download_session_required');
  if(!Number.isFinite(grant.expiresAt)||grant.expiresAt<=now){await removeGrant(directory,id);fail('This installer download expired. Prepare it again in Settings.',410,'download_expired');}
  const file=join(directory,id+'.zip');
  try{await stat(file);}catch(error){if(error.code==='ENOENT')fail('Prepare this installer again in Settings.',410,'download_expired');throw error;}
  return file;
}

if(config.terminal.cloud){
  const cleanup=()=>pruneInstallerDownloads().catch(()=>console.error('Installer download cleanup could not complete.'));
  void cleanup();setInterval(cleanup,5*60000).unref();
}
