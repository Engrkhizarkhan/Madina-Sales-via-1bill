"""Reconnect boundaries: no production database, SSH session or filesystem writes."""
import importlib.util
import os
import pathlib
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('reconnect_control', pathlib.Path(__file__).parents[2] / 'deploy/terminal-control.py')
control = importlib.util.module_from_spec(spec)
with patch('pwd.getpwnam', return_value=types.SimpleNamespace(pw_gid=os.getgid())):
    spec.loader.exec_module(control)

class ReconnectTests(unittest.TestCase):
    def invoke(self, config, healthy, replica=None, now=1000, phase='active', payload=None, failure=None):
        replica = replica or {'configured':True,'ioRunning':True,'sqlRunning':True,'secondsBehind':0,'error':False}
        with patch.object(control,'read_json',return_value={'phase':phase}), \
             patch.object(control,'source_healthy',return_value=healthy) as probe, \
             patch.object(control,'replica_status',return_value=dict(replica)), \
             patch.object(control.time,'time',return_value=now), \
             patch.object(control,'write_json') as save, \
             patch.object(control.subprocess,'run') as terminate, \
             patch.object(control,'run',side_effect=failure) as sql:
            result=control.connection_status(payload or {},config)
        return result,probe,save,terminate,sql

    def test_two_failed_probes_reset_only_the_dedicated_tunnel_with_cooldown(self):
        config={'installationId':'fixture'}
        self.assertFalse(self.invoke(config,False)[0]['tunnelHealthy'])
        self.assertEqual(config['tunnelHealthFailures'],1)
        _,_,_,terminate,sql=self.invoke(config,False,now=1011)
        terminate.assert_called_once_with(['pkill','-TERM','-u','madina-terminal'],check=False,capture_output=True,timeout=5)
        sql.assert_not_called()
        self.invoke(config,False,now=1020)[3].assert_not_called()

    def test_healthy_source_and_replication_lag_do_not_restart_anything(self):
        status={'configured':True,'ioRunning':True,'sqlRunning':True,'secondsBehind':8,'error':False}
        result,_,_,terminate,sql=self.invoke({'tunnelHealthFailures':2},True,status)
        self.assertTrue(result['tunnelHealthy'])
        self.assertEqual(result['secondsBehind'],8)
        terminate.assert_not_called();sql.assert_not_called()

    def test_receiver_restarts_without_resetting_positions_or_stopping_applier(self):
        config={}
        status={'configured':True,'ioRunning':False,'sqlRunning':True,'error':True}
        _,_,_,terminate,sql=self.invoke(config,True,status)
        statement=sql.call_args.args[0][-1]
        self.assertEqual(statement,"STOP REPLICA IO_THREAD FOR CHANNEL 'madina_terminal'; START REPLICA IO_THREAD FOR CHANNEL 'madina_terminal'")
        self.assertEqual(sql.call_args.kwargs['timeout'],6)
        terminate.assert_not_called()
        self.invoke(config,True,status,now=1010)[4].assert_not_called()

    def test_applier_errors_are_reported_and_never_skipped(self):
        status={'configured':True,'ioRunning':True,'sqlRunning':False,'error':True}
        result,_,_,terminate,sql=self.invoke({},True,status)
        self.assertTrue(result['error'])
        terminate.assert_not_called();sql.assert_not_called()

    def test_incomplete_setup_is_not_automatically_reset(self):
        _,probe,save,terminate,sql=self.invoke({},False,phase='preparing')
        probe.assert_not_called();save.assert_not_called();terminate.assert_not_called();sql.assert_not_called()

    def test_wrong_installation_is_rejected_before_repair(self):
        with self.assertRaisesRegex(ValueError,'not registered'):
            self.invoke({'installationId':'current'},False,payload={'installationId':'other'})

    def test_receiver_timeout_reports_error_without_skipping_data(self):
        status={'configured':True,'ioRunning':False,'sqlRunning':True,'error':False}
        result,_,_,terminate,sql=self.invoke({},True,status,failure=RuntimeError('receiver unavailable'))
        self.assertTrue(result['error']);self.assertEqual(sql.call_count,1);terminate.assert_not_called()

if __name__=='__main__':unittest.main()
