import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': process.env.MANILA_SERVER_URL ?? 'http://127.0.0.1:3000',
    },
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
})
