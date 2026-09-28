const path = require('node:path');

module.exports = {
  apps: [{
    name: 'madina-express',
    cwd: path.resolve(__dirname, '..'),
    script: 'backend/node/server.js',
    interpreter: '/opt/node-current/bin/node',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    autorestart: true,
    restart_delay: 3000,
    min_uptime: '10s',
    max_restarts: 20,
    max_memory_restart: '250M',
    kill_timeout: 15000,
    time: true,
    merge_logs: true,
    out_file: '/var/log/madina-express/app-out.log',
    error_file: '/var/log/madina-express/app-error.log',
    env: { NODE_ENV: 'production', TZ: 'Asia/Karachi' },
  }],
};
