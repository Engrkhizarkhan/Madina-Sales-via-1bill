import react from '@vitejs/plugin-react'
import { sites } from '@openai/sites-vite-plugin'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {startCounterPresence} from './shared/terminal-presence.mjs'
import {onlineCounterUrl} from './shared/counter-fallback.mjs'

const startupBundle=()=>readFileSync(resolve('public/startup.js'),'utf8').replace('/*__COUNTER_FALLBACK_HELPER__*/',`var onlineCounterUrlForStartup = ${onlineCounterUrl.toString()};`).replace('/*__COUNTER_PRESENCE__*/',`(${startCounterPresence.toString()})(${JSON.stringify(JSON.parse(readFileSync('build-info.json','utf8')).version)});`)
const workerEntry = ():Plugin => ({
  name: 'madina-express-worker-entry',
  configureServer(server) {
    server.middlewares.use('/startup.js',(_req,res)=>{res.setHeader('Content-Type','application/javascript');res.setHeader('Cache-Control','no-store');res.end(startupBundle())})
  },
  closeBundle() {
    const serverDir = resolve('dist/server')
    mkdirSync(serverDir, { recursive: true })
    writeFileSync(resolve('dist/startup.js'),startupBundle())
    writeFileSync(
      resolve(serverDir, 'index.js'),
      `export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request)
    if (response.status !== 404) return response
    const fallbackUrl = new URL(request.url)
    fallbackUrl.pathname = '/index.html'
    return env.ASSETS.fetch(new Request(fallbackUrl, request))
  }
}\n`,
    )
  },
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    base: env.VITE_PUBLIC_BASE || '/',
    define: { __MADINA_BUILD__: existsSync('build-info.json') ? readFileSync('build-info.json','utf8') : JSON.stringify({version:'3.0.0',releaseId:'development',commit:null,sequence:0}) },
    plugins: [react(), sites(), workerEntry()],
  }
})
