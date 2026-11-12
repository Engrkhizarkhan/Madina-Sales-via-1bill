import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { selectedApplication } from './application-path.mjs';
const application=await selectedApplication();
process.chdir(application);
await import(pathToFileURL(join(application,'backend/node/server.js')).href);
