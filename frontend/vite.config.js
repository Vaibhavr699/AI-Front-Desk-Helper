import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    host: '0.0.0.0',
    port: 3089,        
    strictPort: true,        
    allowedHosts: [
      'unjudged-westwardly-trisha.ngrok-free.dev'
    ],
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.BACKEND_PORT || 3000}`,
        changeOrigin: true
      },
      '/twilio': {
        target: `http://localhost:${process.env.BACKEND_PORT || 3000}`,
        changeOrigin: true
      },
    },
  },
})