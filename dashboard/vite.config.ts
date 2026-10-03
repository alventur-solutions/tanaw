import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  if (mode === 'production' && !env.VITE_API_BASE_URL?.trim()) {
    throw new Error('Set VITE_API_BASE_URL to the deployed API Function URL before building.')
  }

  return {
    plugins: [react()],
    // MapLibre 6 loads its worker from a file next to the library. Pre-bundling breaks that path.
    optimizeDeps: { exclude: ['maplibre-gl'] },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
