import { readFile,realpath,access } from 'node:fs/promises';
import { resolve,join } from 'node:path';
export async function selectedApplication(pointer='/var/lib/madina-express/host/current.json',allowed=['/opt/madina-express','/var/lib/madina-express/releases']){
 const record=JSON.parse(await readFile(pointer,'utf8'));
 if(typeof record.application!=='string')throw new Error('The application pointer is invalid');
 const application=await realpath(resolve(record.application));
 if(!allowed.some(root=>application===resolve(root)||application.startsWith(resolve(root)+'/')))throw new Error('The application path is outside the managed release directory');
 await access(join(application,'backend/node/server.js'));
 return application;
}
