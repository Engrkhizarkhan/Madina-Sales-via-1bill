#!/usr/bin/python3
"""Serve one fixed terminal-control request from an authenticated local app process."""
import json
import os
import pwd
import socket
import struct
import subprocess
import sys

ACTIONS = frozenset(('prepare', 'register', 'freeze', 'activate', 'abort', 'status'))
MAX_REQUEST = 16384

def main():
    connection = socket.socket(fileno=0)
    connection.settimeout(10)
    _pid, uid, _gid = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))
    if uid != pwd.getpwnam('madina-express').pw_uid:
        raise ValueError('This connection is not authorized.')
    data = bytearray()
    while b'\n' not in data:
        chunk = connection.recv(min(4096, MAX_REQUEST + 1 - len(data)))
        if not chunk:
            raise ValueError('Incomplete terminal-control request.')
        data.extend(chunk)
        if len(data) > MAX_REQUEST:
            raise ValueError('Terminal-control request is too large.')
    request = json.loads(data.split(b'\n', 1)[0])
    if not isinstance(request, dict) or request.get('action') not in ACTIONS or not isinstance(request.get('payload', {}), dict):
        raise ValueError('Invalid terminal-control action.')
    result = subprocess.run(['/usr/local/libexec/madina-terminal-control', request['action']],
                            input=json.dumps(request.get('payload', {})), text=True,
                            capture_output=True, timeout=180, check=False)
    if result.returncode:
        print(result.stderr[-1000:], file=sys.stderr)
        response = {'ok': False, 'error': 'Terminal setup could not finish. Check its service logs.'}
    else:
        response = {'ok': True, 'result': json.loads(result.stdout)}
    connection.sendall((json.dumps(response) + '\n').encode())

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not echo request data: it can contain installation credentials.
        print('Terminal broker failed: ' + type(error).__name__, file=sys.stderr)
        try:
            os.write(1, b'{"ok":false,"error":"The terminal-control request was rejected."}\n')
        except OSError:
            pass
        sys.exit(1)
