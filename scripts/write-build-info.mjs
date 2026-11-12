import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync } from 'node:fs';
const pkg=JSON.parse(readFileSync('package.json','utf8'));
let commit=process.env.RELEASE_COMMIT;
if(!commit){try{commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();}catch{commit=null;}}
writeFileSync('build-info.json',JSON.stringify({version:pkg.version,releaseId:commit?'r-'+commit.slice(0,12):'development',commit,sequence:Number(process.env.RELEASE_SEQUENCE||0)},null,2)+'\n');
