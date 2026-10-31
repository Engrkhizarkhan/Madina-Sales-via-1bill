import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
dotenv.config({path:resolve('backend','.env')});
const env=process.env;
if(!/^[a-zA-Z0-9_]+$/.test(env.DB_NAME||''))throw new Error('Invalid DB_NAME.');
const only=process.argv[2];
if(only&&!/^\d+_[a-z0-9_]+\.sql$/.test(only))throw new Error('Pass an exact migration filename.');
const root=resolve('backend/database/migrations');
const files=(await readdir(root)).filter(f=>f.endsWith('.sql')&&(!only||f===only)).sort();
if(!files.length)throw new Error('Migration not found.');
const db=await mysql.createConnection({...(env.MYSQL_ADMIN_SOCKET?{socketPath:env.MYSQL_ADMIN_SOCKET}:{host:env.DB_HOST||'127.0.0.1',port:Number(env.DB_PORT||3306)}),user:env.MYSQL_ADMIN_USER||'root',password:env.MYSQL_ADMIN_PASSWORD||'',database:env.DB_NAME,multipleStatements:true});
try{for(const file of files){await db.query(await readFile(resolve(root,file),'utf8'));console.log(`Applied ${file}`);}}finally{await db.end();}
