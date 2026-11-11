"""Recovery boundaries for unfinished setup, using disposable state and no real SQL."""
import importlib.util
import contextlib
import io
import json
import os
import pathlib
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('terminal_control', pathlib.Path(__file__).parents[2] / 'deploy/terminal-control.py')
control = importlib.util.module_from_spec(spec)
with patch('pwd.getpwnam', return_value=types.SimpleNamespace(pw_gid=os.getgid())):
    spec.loader.exec_module(control)

class ResetTests(unittest.TestCase):
    def setup_state(self, root, phase):
        (root/'state.json').write_text(json.dumps({'phase':phase}))
        (root/'private.json').write_text('{"installToken":"old-fixture"}')
        (root/'snapshot.sql').write_text('fixture')

    def invoke(self, root):
        with patch.object(control,'ROOT',root), patch.object(control,'STATE',root/'state.json'), \
             patch.object(control,'CONFIG',root/'private.json'), patch.object(control.os,'geteuid',return_value=0), \
             patch.object(control.os,'chown'), patch.object(control.sys,'argv',['terminal-control','reset']), \
             patch.object(control.sys,'stdin',io.StringIO('{}')), patch.object(control,'replica_status',return_value={'configured':False}), \
             patch.object(control,'sql') as sql, patch.object(control.subprocess,'run') as run, contextlib.redirect_stdout(io.StringIO()):
            control.main()
        return sql,run

    def test_unfinished_setup_is_revoked_and_writer_restored(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);self.setup_state(root,'preparing')
            sql,run=self.invoke(root)
            self.assertEqual(json.loads((root/'state.json').read_text()),{'phase':'standalone'})
            self.assertFalse((root/'private.json').exists());self.assertFalse((root/'snapshot.sql').exists())
            self.assertEqual([call.args[0] for call in sql.call_args_list],['SET PERSIST super_read_only=OFF','SET PERSIST read_only=OFF'])
            run.assert_called_once_with(['pkill','-u','madina-terminal'],check=False)

    def test_active_source_is_never_reset_or_made_second_writer(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);self.setup_state(root,'active')
            with self.assertRaisesRegex(ValueError,'verified data recovery'):self.invoke(root)
            self.assertTrue((root/'private.json').exists());self.assertTrue((root/'snapshot.sql').exists())
            self.assertEqual(json.loads((root/'state.json').read_text())['phase'],'active')

if __name__=='__main__':unittest.main()
