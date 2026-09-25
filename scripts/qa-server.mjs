// Local same-origin browser QA against the real Node/MySQL API. Never used in production.
import express from 'express';
import { resolve } from 'node:path';
import { app } from '../backend/node/app.js';
const server = express();
server.use('/api', app);
server.use(express.static(resolve('dist')));
server.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
server.listen(3106, '127.0.0.1', () => console.log('QA: http://127.0.0.1:3106'));
