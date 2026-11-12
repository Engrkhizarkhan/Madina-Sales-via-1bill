// Deliberately separate from seeding/install scripts: updates never reset application data.
import mysql from 'mysql2/promise';
import { applyMigrations } from './migrations.js';
import { readFile } from 'node:fs/promises';
const file=process.argv[2];
if(!file)throw new Error('Pass the protected database administrator configuration');
const source=await readFile(file,'utf8');
const config=Object.fromEntries(source.split(/\r?\n/).map(line=>line.match(/^([a-zA-Z_]+)=(.*)$/)).filter(Boolean).map(([,key,value])=>[key,value]));
const database=config.database||'madina_express';if(!/^[a-zA-Z0-9_]+$/.test(database))throw new Error('Invalid database');
const db=await mysql.createConnection({...(config.socket?{socketPath:config.socket}:{host:config.host||'127.0.0.1',port:Number(config.port||3306)}),user:config.user||'root',password:config.password||'',database,multipleStatements:true});
try{
 const [[locked]]=await db.query("SELECT GET_LOCK('madina_schema_update',30) acquired");if(!locked.acquired)throw new Error('Another migration is in progress');
 await applyMigrations(db);
}finally{await db.end();}
