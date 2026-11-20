import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {atomicJson,atomicText,jsonFile} from './engine.mjs';
import {staffOrigin,terminalOrigin,webOrigins} from '../../shared/domains.mjs';

const environmentValues = source => Object.fromEntries(source.replace(/^\uFEFF/,'').split(/\r?\n/)
  .map(line=>line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(([,key,value])=>[key,value]));
function setValue(source,key,value) {
  const pattern=new RegExp('^'+key+'=.*$','gm');
  return pattern.test(source) ? source.replace(pattern,()=>key+'='+value) : source.replace(/\s*$/,'')+'\n'+key+'='+value+'\n';
}
async function preserve(file,source) {
  try {await writeFile(file,source,{flag:'wx',mode:0o600,flush:true});}
  catch(error){if(error.code!=='EEXIST')throw error;}
}

// Runs as SYSTEM from the accepted release's migration entrypoint, while the
// app is stopped. It changes no database rows, LAN IP, TLS key or device access.
export async function migrateCloudDomain(base) {
  const envFile=join(base,'config/backend.env'),updaterFile=join(base,'host/updater.json');
  const source=await readFile(envFile,'utf8'),before=environmentValues(source);
  const updater=await jsonFile(updaterFile);
  if(updater?.project!=='madina-express')throw new Error('A protected Madina Express updater configuration is required.');
  if(![staffOrigin,terminalOrigin].includes(before.TERMINAL_CLOUD_ORIGIN) || ![staffOrigin,terminalOrigin].includes(updater.cloudOrigin)) {
    throw new Error('The configured cloud is not an approved Madina Express domain. No settings were changed.');
  }
  const origins=[...new Set([...(before.ALLOWED_ORIGINS||'').split(',').filter(value=>value&&(webOrigins.includes(value)||new URL(value).port==='8443')),...webOrigins])];
  let after=setValue(source,'TERMINAL_CLOUD_ORIGIN',terminalOrigin);
  after=setValue(after,'ALLOWED_ORIGINS',origins.join(','));
  const settings={...updater,cloudOrigin:terminalOrigin};
  if(after===source&&updater.cloudOrigin===terminalOrigin)return {changed:false,cloudOrigin:terminalOrigin};
  await preserve(envFile+'.pre-pk',source);
  await preserve(updaterFile+'.pre-pk',JSON.stringify(updater));
  try {
    await atomicText(envFile,after);
    await atomicJson(updaterFile,settings);
  } catch(error) {
    await atomicText(envFile,source);
    await atomicJson(updaterFile,updater);
    throw error;
  }
  await atomicJson(join(base,'host/cloud-domain-migration.json'),{
    cloudOrigin:terminalOrigin,fallbackOrigin:staffOrigin,completedAt:new Date().toISOString(),
  });
  return {changed:true,cloudOrigin:terminalOrigin};
}
