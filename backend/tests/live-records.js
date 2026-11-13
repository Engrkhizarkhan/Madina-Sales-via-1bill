import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeLiveRecords} from '../../shared/live-records.mjs';
import {expiredBackup,backupRetentionMs} from '../../deploy/updater/backup-retention.mjs';

test('background merges preserve unchanged objects, history and replay safety',()=>{
  const old={id:'old',date:'2020-01-01',paid:2200},current={id:'current',date:'2026-11-13',paid:100};
  const records=[current,old];
  assert.equal(mergeLiveRecords(records),records);
  assert.equal(mergeLiveRecords(records,[{...current}]),records);
  const updated={...current,paid:500},added={id:'new',paid:300};
  const result=mergeLiveRecords(records,[updated,added]);
  assert.equal(result.find(row=>row.id==='old'),old);
  assert.equal(result.find(row=>row.id==='current'),updated);
  assert.equal(result.reduce((sum,row)=>sum+row.paid,0),3000);
  assert.equal(mergeLiveRecords(result,[updated,added]),result);
  assert.deepEqual(mergeLiveRecords(result,[],['current']).map(row=>row.id),['new','old']);
  assert.deepEqual(records,[current,old]);
});

test('seven-day backup cleanup preserves recent backups, partial files and unrelated data',()=>{
  const now=Date.parse('2026-11-13T12:00:00Z');
  assert.equal(backupRetentionMs,7*86400000);
  assert.equal(expiredBackup('madina-20261106T120001Z.sql.gz',0,now),false);
  assert.equal(expiredBackup('madina-20261106T115959Z.sql.gz',0,now),true);
  assert.equal(expiredBackup('madina-20261113T100000Z.sql.gz',0,now),false);
  assert.equal(expiredBackup('pre-update-2026-11-01T00-00-00-000Z.sql.gz',now-8*86400000,now),true);
  assert.equal(expiredBackup('pre-update-2026-11-12T00-00-00-000Z.sql.gz',now-86400000,now),false);
  assert.equal(expiredBackup(`production-reset-${now-8*86400000}-aa23.json.gz`,0,now),true);
  for(const name of ['madina-20261101T000000Z.sql.gz.part','backend.env','mysql-admin.cnf','personal-backup.sql.gz','ca.key','server.log'])assert.equal(expiredBackup(name,0,now),false);
});
