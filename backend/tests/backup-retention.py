import os
import pathlib
import subprocess
import tempfile
import time
import unittest


class CloudRetention(unittest.TestCase):
    def test_actual_cleanup_commands_remove_only_expired_managed_backups(self):
        script=(pathlib.Path(__file__).parents[2]/'deploy/backup.sh').read_text()
        commands='\n'.join(line for line in script.splitlines() if line.startswith('find "$BACKUP_DIR"'))
        with tempfile.TemporaryDirectory(prefix='madina-retention-qa-') as directory:
            old=['madina-express-20260101T000000Z.sql.gz','pre-update-2026-01-01T00-00-00-000Z.sql.gz']
            keep=['madina-express-20261113T000000Z.sql.gz','pre-update-2026-11-13T00-00-00-000Z.sql.gz','mysql-admin.cnf','ca.key','personal.sql.gz','madina-express-20260101T000000Z.sql.gz.part']
            for name in old+keep:
                path=pathlib.Path(directory,name);path.touch()
                age=9 if name in old or name in keep[2:] else 1
                stamp=time.time()-age*86400;os.utime(path,(stamp,stamp))
            subprocess.run(['bash','-euc',commands],env={**os.environ,'BACKUP_DIR':directory},check=True)
            self.assertEqual(sorted(path.name for path in pathlib.Path(directory).iterdir()),sorted(keep))


if __name__=='__main__':
    unittest.main()
