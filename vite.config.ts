import react from '@vitejs/plugin-react'
import { sites } from '@openai/sites-vite-plugin'
import { defineConfig, loadEnv } from 'vite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const workerEntry = () => ({
  name: 'madina-express-worker-entry',
  closeBundle() {
    const serverDir = resolve('dist/server')
    mkdirSync(serverDir, { recursive: true })
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
    plugins: [react(), sites(), workerEntry()],
  }
})
