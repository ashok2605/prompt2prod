import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// The dashboard is served by FastAPI from `dist/` at `/`, so API calls are
// same-origin by default. For local development against a running backend set
// DEV_API_PROXY (e.g. http://localhost:8080) to proxy /api, or set
// VITE_API_BASE to call a different origin directly (requires CORS).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.DEV_API_PROXY
  return {
    base: './',
    plugins: [react()],
    server: {
      port: 5173,
      proxy: proxyTarget ? { '/api': { target: proxyTarget, changeOrigin: true } } : undefined,
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 1200,
    },
  }
})
