import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs/promises'
import path from 'node:path'
const pdfFolders = ['cmaps', 'standard_fonts', 'wasm', 'iccs']
async function pdfAssets() {
  const result = new Map<string, Buffer>()
  for (const folder of pdfFolders) {
    const root = path.resolve('node_modules/pdfjs-dist', folder)
    for (const file of await fs.readdir(root)) {
      if (
        (!file.startsWith('quickjs') && /\.(bcmap|ttf|pfb|wasm|icc)$/.test(file)) ||
        file.endsWith('_nowasm_fallback.js')
      )
        result.set(`${folder}/${file}`, await fs.readFile(path.join(root, file)))
    }
  }
  return result
}
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'sheco-local-pdf-resources',
      async generateBundle() {
        for (const [file, source] of await pdfAssets())
          this.emitFile({ type: 'asset', fileName: 'pdfjs/' + file, source })
      },
      async configureServer(server) {
        const assets = await pdfAssets()
        server.middlewares.use('/pdfjs', (request, response) => {
          const file = request.url?.slice(1) ?? ''
          const bytes = assets.get(file)
          if (!bytes) {
            response.statusCode = 404
            response.end()
            return
          }
          response.setHeader(
            'Content-Type',
            file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream',
          )
          response.setHeader('X-Content-Type-Options', 'nosniff')
          response.end(bytes)
        })
      },
    },
    {
      name: 'sheco-development-csp',
      transformIndexHtml(html, context) {
        // Vite's local React refresh preamble is inline; packaged builds keep script-src 'self'.
        return context.server
          ? html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
          : html
      },
    },
  ],
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { target: 'chrome144', sourcemap: true },
})
