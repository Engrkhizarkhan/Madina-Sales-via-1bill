import {pool,transaction} from './db.js';

// A compact latest-change index, not another copy of passenger/payment data.
// Always acquire the clock inside the business transaction, so an uncommitted
// earlier change cannot be skipped by a client that sees a later commit.
export async function recordLiveEntries(executor, entries) {
  const unique=[...new Map(entries.map(entry=>[entry.join(':'),entry])).values()];
  if (!unique.length) return;
  if (executor===pool) return transaction(connection=>recordLiveEntries(connection,unique));
  await executor.execute('UPDATE live_state SET revision=revision+1 WHERE id=1');
  await executor.query(`INSERT INTO live_changes(entity_type,entity_id,revision) VALUES ${unique.map(()=>'(?,?,(SELECT revision FROM live_state WHERE id=1))').join(',')}
    ON DUPLICATE KEY UPDATE revision=VALUES(revision)`,unique.flat());
}

export async function recordAuditedChange(executor,action,type,id,before,after) {
  if (type==='booking') {
    const run=after?.tripRunId||before?.tripRunId;
    return recordLiveEntries(executor,[['booking',String(id)],...(run?[['run',run]]:[])]);
  }
  if (type==='trip_run') {
    const [bookings]=await executor.execute('SELECT id FROM bookings WHERE trip_run_id=?',[String(id)]);
    return recordLiveEntries(executor,[['run',String(id)],['catalog','all'],...bookings.map(booking=>['booking',booking.id])]);
  }
  if (action==='production.data_cleared') return recordLiveEntries(executor,[['reset','all']]);
  if (['route','bus','trip','crew','settings'].includes(type)||type==='user'&&!/^(auth\.|finance\.)/.test(action)) {
    return recordLiveEntries(executor,[['catalog','all']]);
  }
}
