import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    proxy: {
      '/api': { target: `http://localhost:${process.env.BACKEND_PORT || 3000}`, changeOrigin: true },
      '/twilio': { target: `http://localhost:${process.env.BACKEND_PORT || 3000}`, changeOrigin: true },
    },
  },
})
