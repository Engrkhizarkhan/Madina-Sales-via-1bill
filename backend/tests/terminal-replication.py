#!/usr/bin/python3
"""Run as root on a Linux test host with MySQL 8.0. Uses two disposable instances only."""
import importlib.util
import os
import pathlib
import pwd
import shutil
import socket
import subprocess
import tempfile
import time

service = pwd.getpwnam('mysql')
base = pathlib.Path(tempfile.mkdtemp(prefix='madina-replication-qa-', dir='/var/lib/mysql'))
os.chown(base, service.pw_uid, service.pw_gid)
servers = []

def mysql(index, statement):
    result = subprocess.run(['mysql', '--no-defaults', '--socket=' + str(base / str(index) / 'mysql.sock'),
                             '-uroot', '-NB', '-e', statement], capture_output=True, text=True, timeout=30)
    if result.returncode: raise RuntimeError('QA SQL failed: ' + result.stderr[:400])
    return result.stdout.strip()

def wait_equal(statement, expected):
    for _ in range(60):
        if mysql(2, statement) == expected: return
        time.sleep(0.2)
    raise AssertionError('Replica did not reach expected state.')

try:
    # Production relay port must not be occupied; never interrupt an existing terminal.
    with socket.socket() as check:
        check.bind(('127.0.0.1', 13306))
    for index, port in [(1, 13306), (2, 13406)]:
        directory = base / str(index)
        directory.mkdir()
        os.chown(directory, service.pw_uid, service.pw_gid)
        args = ['mysqld', '--no-defaults', '--user=mysql', '--datadir=' + str(directory),
                '--socket=' + str(directory / 'mysql.sock'), '--mysqlx=OFF', '--port=' + str(port),
                '--bind-address=127.0.0.1', '--server-id=' + str(index + 400), '--log-bin=' + str(directory / 'binlog'),
                '--log-error=' + str(directory / 'error.log'), '--pid-file=' + str(directory / 'mysqld.pid'),
                '--gtid-mode=' + ('ON' if index == 1 else 'OFF'), '--enforce-gtid-consistency=ON']
        initialized = subprocess.run(args + ['--initialize-insecure'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if initialized.returncode:
            raise RuntimeError('QA initialization failed: ' + (directory / 'error.log').read_text()[-1200:])
        servers.append(subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        for _ in range(100):
            try: mysql(index, 'SELECT 1'); break
            except RuntimeError: time.sleep(0.2)
        else: raise RuntimeError('QA MySQL startup failed.')
        mysql(index, "SET SESSION sql_log_bin=0; CREATE DATABASE madina_express; CREATE TABLE madina_express.bookings (id INT PRIMARY KEY, seat INT UNIQUE, paid INT); INSERT INTO madina_express.bookings VALUES (1, 8, 2200)")
    mysql(1, "SET SESSION sql_log_bin=0; CREATE USER 'madina_repl'@'127.0.0.1' IDENTIFIED BY 'IsolatedReplicationTestPassword'; GRANT REPLICATION SLAVE ON *.* TO 'madina_repl'@'127.0.0.1'")
    spec = importlib.util.spec_from_file_location('terminal_control', pathlib.Path(__file__).parents[2] / 'deploy/terminal-control.py')
    control = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(control)
    original_run = control.run
    def qa_run(args, **kwargs):
        if args[0] != 'mysql': raise RuntimeError('Unexpected non-QA command.')
        return original_run(['mysql', '--no-defaults', '--socket=' + str(base / '2/mysql.sock'), '-uroot', *args[1:]], **kwargs)
    control.run = qa_run
    control.configure_replication({'replicationPassword': 'IsolatedReplicationTestPassword'})
    print('PASS production replication configuration starts on isolated MySQL instances')
    mysql(1, 'INSERT INTO madina_express.bookings VALUES (2, 9, 2250)')
    wait_equal('SELECT COUNT(*) FROM madina_express.bookings', '2')
    print('PASS a new local booking reaches the cloud copy')
    mysql(2, "STOP REPLICA IO_THREAD FOR CHANNEL 'madina_terminal'")
    mysql(1, 'INSERT INTO madina_express.bookings VALUES (3, 10, 2300), (4, 11, 2400)')
    assert mysql(2, 'SELECT COUNT(*) FROM madina_express.bookings') == '2'
    print('PASS local bookings continue while cloud replication is disconnected')
    mysql(2, "START REPLICA IO_THREAD FOR CHANNEL 'madina_terminal'")
    wait_equal('SELECT COUNT(*) FROM madina_express.bookings', '4')
    assert mysql(2, 'SELECT SUM(paid) FROM madina_express.bookings') == '9150'
    print('PASS reconnect catches up exactly once with matching payment totals')
    mysql(2, "SET GLOBAL super_read_only=OFF; CREATE USER 'qa_writer'@'localhost'; GRANT INSERT ON madina_express.* TO 'qa_writer'@'localhost'; SET GLOBAL super_read_only=ON")
    blocked = subprocess.run(['mysql', '--no-defaults', '--socket=' + str(base / '2/mysql.sock'), '-uqa_writer', '-e', 'INSERT INTO madina_express.bookings VALUES (5,12,2500)'], capture_output=True)
    assert blocked.returncode != 0 and b'read-only' in blocked.stderr
    print('PASS the cloud replica rejects a second writer')
    control.configure_replication({'replicationPassword': 'IsolatedReplicationTestPassword'})
    wait_equal('SELECT COUNT(*) FROM madina_express.bookings', '4')
    print('PASS activation retry preserves the replication position')
finally:
    for process in servers: process.terminate()
    for process in servers:
        try: process.wait(timeout=30)
        except subprocess.TimeoutExpired: process.kill(); process.wait()
    shutil.rmtree(base)
