"""Protocol and peer checks for the root helper; no root or database is needed."""
import importlib.util
import json
import pathlib
import struct
import types
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('terminal_broker', pathlib.Path(__file__).parents[2] / 'deploy/terminal-broker.py')
broker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(broker)

class BrokerTests(unittest.TestCase):
    def run_request(self, request, uid=456, result=None, raw=None):
        connection = Mock()
        connection.getsockopt.return_value = struct.pack('3i', 123, uid, 456)
        message = raw if raw is not None else json.dumps(request).encode() + b'\n'
        connection.recv.side_effect = [message, b'']
        if result is None:
            result = types.SimpleNamespace(returncode=0, stdout='{"prepared":true}', stderr='')
        with patch.object(broker.socket, 'SO_PEERCRED', 17, create=True), \
             patch.object(broker.socket, 'socket', return_value=connection), \
             patch.object(broker.pwd, 'getpwnam', return_value=types.SimpleNamespace(pw_uid=456)), \
             patch.object(broker.subprocess, 'run', return_value=result) as execute:
            broker.main()
        return connection, execute

    def test_fixed_helper_and_action(self):
        connection, execute = self.run_request({'action': 'prepare', 'payload': {}})
        self.assertEqual(execute.call_args.args[0], ['/usr/local/libexec/madina-terminal-control', 'prepare'])
        self.assertEqual(json.loads(execute.call_args.kwargs['input']), {})
        self.assertEqual(execute.call_args.kwargs['timeout'], 180)
        self.assertEqual(json.loads(connection.sendall.call_args.args[0]), {'ok': True, 'result': {'prepared': True}})

    def test_wrong_uid_rejected_before_execution(self):
        with self.assertRaisesRegex(ValueError, 'not authorized'):
            self.run_request({'action': 'prepare'}, uid=999)

    def test_unknown_actions_rejected(self):
        for action in ['shell', 'prepare --help', '/bin/sh']:
            with self.subTest(action=action), self.assertRaisesRegex(ValueError, 'Invalid'):
                self.run_request({'action': action, 'payload': {}})

    def test_non_object_payload_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Invalid'):
            self.run_request({'action': 'register', 'payload': ['unexpected']})

    def test_oversized_request_rejected(self):
        with self.assertRaisesRegex(ValueError, 'too large'):
            self.run_request(None, raw=b'x' * 16385)

    def test_incomplete_request_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            self.run_request(None, raw=b'{"action":"prepare"}')

    def test_child_errors_do_not_echo_private_output(self):
        result = types.SimpleNamespace(returncode=1, stdout='', stderr='diagnostic-private-value')
        with patch('sys.stderr'):
            connection, _execute = self.run_request({'action': 'prepare'}, result=result)
        response = json.loads(connection.sendall.call_args.args[0])
        self.assertFalse(response['ok'])
        self.assertNotIn('diagnostic-private-value', response['error'])

if __name__ == '__main__':
    unittest.main()
