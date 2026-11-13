export const backupRetentionDays=7;
export const backupRetentionMs=backupRetentionDays*86400000;

// Only application-generated database backups are eligible. Config files,
// certificates, arbitrary filenames and the live database are never removed.
export function expiredBackup(name,mtimeMs,now=Date.now()) {
  let stamp;
  const daily=name.match(/^madina-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.sql\.gz$/);
  const reset=name.match(/^production-reset-(\d+)(?:-[a-f0-9]+)?\.json\.gz$/);
  if(daily)stamp=Date.parse(`${daily[1]}-${daily[2]}-${daily[3]}T${daily[4]}:${daily[5]}:${daily[6]}Z`);
  else if(reset)stamp=Number(reset[1]);
  else if(/^pre-update-[0-9TZ-]+\.sql\.gz$/.test(name))stamp=mtimeMs;
  else return false;
  return Number.isFinite(stamp)&&stamp<now-backupRetentionMs;
}
