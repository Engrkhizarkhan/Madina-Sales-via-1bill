import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isIP} from 'node:net';
import {resolve} from 'node:path';
const execute=promisify(execFile);
export async function readWindowsNetwork(address,{platform=process.platform,run=execute}={}) {
  if(platform!=='win32')return {available:false,reason:'not-windows'};
  if(isIP(address)!==4||!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address))return {available:false,reason:'invalid-lan-address'};
  try{
    const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('deploy/windows/Read-Terminal-Network.ps1'),'-Address',address],{windowsHide:true,timeout:12000,maxBuffer:128*1024,encoding:'utf8'});
    return {available:true,report:JSON.parse(stdout.replace(/^\uFEFF/,'').trim())};
  }catch(error){return {available:false,reason:error.killed?'diagnostic-timeout':'diagnostic-unavailable'};}
}
