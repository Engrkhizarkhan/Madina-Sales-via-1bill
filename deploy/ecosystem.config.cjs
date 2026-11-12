const path = require('node:path');
const fs = require('node:fs');
let application = path.resolve(__dirname, '..');
try { application = JSON.parse(fs.readFileSync('/var/lib/madina-express/host/current.json','utf8')).application; } catch { /* initial deployment */ }

module.exports = {
  apps: [{
    name: 'madina-express',
    cwd: fs.existsSync('/usr/local/libexec/madina-updater/run-api.mjs') ? '/var/lib/madina-express' : application,
    script: fs.existsSync('/usr/local/libexec/madina-updater/run-api.mjs') ? '/usr/local/libexec/madina-updater/run-api.mjs' : 'backend/node/server.js',
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
    env: { NODE_ENV: 'production', TZ: 'Asia/Karachi', MADINA_ENV_FILE: fs.existsSync('/etc/madina-express/backend.env') ? '/etc/madina-express/backend.env' : path.join(application,'backend/.env') },
  }],
};
