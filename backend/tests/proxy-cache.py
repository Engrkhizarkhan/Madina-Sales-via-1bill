#!/usr/bin/env python3
"""Run a separate unprivileged nginx instance; never alter a deployed server."""
import http.client
import pathlib
import re
import shutil
import socket
import subprocess
import tempfile
import time

project = pathlib.Path(__file__).resolve().parents[2]
nginx = shutil.which('nginx') or '/usr/sbin/nginx'
with tempfile.TemporaryDirectory(prefix='madina-proxy-qa-') as name:
    base = pathlib.Path(name)
    site = base / 'site'
    (site / 'assets').mkdir(parents=True)
    (site / 'index.html').write_text('current application')
    (site / 'startup.js').write_text('current startup')
    (site / 'assets/index-ABCD1234.js').write_text('fingerprinted javascript')
    (site / 'assets/plain.js').write_text('unversioned javascript')
    (site / '.env').write_text('private value must not be served')
    (site / '.git').mkdir()
    (site / '.git/config').write_text('private repository')
    maps = []
    for template in ['nginx-production.conf.template', 'nginx-terminal.conf.template']:
        text = (project / 'deploy' / template).read_text()
        maps.append(re.search(r'map "\$status:\$uri" \$madina_cache_control \{.*?\n\}', text, re.S).group())
    assert maps[0] == maps[1]
    common = (project / 'deploy/nginx-production-common.conf.template').read_text()
    common = re.sub(r'(?m)^ssl_[^;]+;\n', '', common)
    common = common.replace('include /etc/nginx/snippets/madina-cloudflare-realip.conf;', '')
    common = common.replace('/var/www/madina-express', str(site))
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
    config = base / 'nginx.conf'
    config.write_text(f'pid {base}/nginx.pid;\nerror_log {base}/error.log;\nevents {{worker_connections 128;}}\nhttp {{ access_log off; include /etc/nginx/mime.types; {maps[0]} server {{ listen 127.0.0.1:{port}; {common} location / {{ try_files $uri /index.html; }} }} }}')
    command = [nginx, '-p', str(base), '-c', str(config)]
    subprocess.run(command + ['-t'], check=True)
    process = subprocess.Popen(command + ['-g', 'daemon off;'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for attempt in range(100):
            try:
                with socket.create_connection(('127.0.0.1', port), timeout=.2):
                    break
            except OSError:
                time.sleep(.05)
        def get(path, request_headers=None, method='GET'):
            connection = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
            try:
                connection.request(method, path, headers=request_headers or {})
                result = connection.getresponse()
                return result.status, dict(result.getheaders()), result.read()
            finally:
                connection.close()
        for path in ['/manage', '/login', '/index.html', '/startup.js', '/startup.js?v=new-release', '/assets/plain.js']:
            status, headers, body = get(path)
            assert status == 200, (path, status, body)
            assert 'no-store' in headers['Cache-Control'], (path, headers)
        status, headers, _ = get('/assets/index-ABCD1234.js')
        assert status == 200 and headers['Cache-Control'] == 'public, max-age=31536000, immutable', headers
        for name in ['Content-Security-Policy', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy']:
            assert name in headers, name
        for path in ['/assets/index-MISSING1.js', '/.env', '/.git/config']:
            status, headers, body = get(path)
            assert status == 404, (path, status)
            assert 'no-store' in headers['Cache-Control'], (path, headers)
            assert b'private value' not in body and b'private repository' not in body
        status, headers, _ = get('/browser-recovery')
        assert status == 404 and 'Clear-Site-Data' not in headers
        status, headers, _ = get('/browser-recovery', {'X-Madina-Recovery': 'startup'})
        assert status == 204 and headers['Clear-Site-Data'] == '"cache"'
        assert 'no-store' in headers['Cache-Control'] and 'Set-Cookie' not in headers
        status, headers, _ = get('/browser-recovery', {'X-Madina-Recovery': 'startup'}, 'POST')
        assert status == 405 and 'Clear-Site-Data' not in headers
        print('PASS nginx syntax, mutable startup/HTML no-store, hashed asset caching, retained security headers, private paths and uncached 404s')
    finally:
        process.terminate()
        process.wait(timeout=10)
