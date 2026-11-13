const pending=new WeakMap();
export const beginChanges=connection=>pending.set(connection,new Map());
export const endChanges=connection=>pending.delete(connection);
export function queueChanges(connection,entries) {
  const changes=pending.get(connection);
  if(!changes)return false;
  for(const entry of entries)changes.set(entry.join(':'),entry);
  return true;
}

export async function writeChanges(connection,entries) {
  if(!entries.length)return;
  await connection.execute('UPDATE live_state SET revision=revision+1 WHERE id=1');
  await connection.query(`INSERT INTO live_changes(entity_type,entity_id,revision) VALUES ${entries.map(()=>'(?,?,(SELECT revision FROM live_state WHERE id=1))').join(',')}
    ON DUPLICATE KEY UPDATE revision=VALUES(revision)`,entries.flat());
}

// Take the shared clock only after all business/FK locks have been acquired.
// There are no further business writes after this point, avoiding a new lock
// ordering cycle between bulk ticket sales and concurrent account/schedule edits.
export async function flushChanges(connection) {
  const changes=pending.get(connection);
  if(changes?.size)await writeChanges(connection,[...changes.values()]);
}
