import { readdir,readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
export async function applyMigrations(db){
 await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(100) PRIMARY KEY,sha256 CHAR(64) NOT NULL,applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB');
 const [[legacy]]=await db.query("SELECT (EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='terminal_enrollments') AND EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bookings' AND COLUMN_NAME='reservation_no')) ready");
 const files=(await readdir(resolve('backend/database/migrations'))).filter(name=>/^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
 for(const name of files){
  const sql=await readFile(resolve('backend/database/migrations',name),'utf8'),hash=createHash('sha256').update(sql).digest('hex');
  const [[before]]=await db.execute('SELECT sha256 FROM schema_migrations WHERE name=?',[name]);
  if(before){if(before.sha256!==hash)throw new Error('An already applied migration was modified: '+name);continue;}
  // Existing v2 installations already applied 001–011. Replaying those data conversions
  // would clear reservation expiry and can rewrite historical records.
  if(!(legacy.ready&&Number(name.split('_')[0])<=11))await db.query(sql);
  await db.execute('INSERT INTO schema_migrations(name,sha256) VALUES (?,?)',[name,hash]);
  console.log('Recorded migration '+name);
 }
}
