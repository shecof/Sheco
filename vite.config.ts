import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [
    react(),
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
