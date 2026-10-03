import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The API runs on port 8000 (uvicorn api.main:app). The dashboard calls it as /api.
export default defineConfig({
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
})
