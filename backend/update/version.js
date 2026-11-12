import { readFile } from 'node:fs/promises';
let build;
try { build=JSON.parse(await readFile(new URL('../../build-info.json',import.meta.url),'utf8')); }
catch { build={version:'3.0.0',releaseId:'development',commit:null,sequence:0}; }
export const releaseInfo=Object.freeze({version:build.version,releaseId:build.releaseId,commit:build.commit||null,sequence:Number(build.sequence||0)});
