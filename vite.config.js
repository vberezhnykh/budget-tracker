import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiTarget = process.env.BUDGET_TRACKER_API_TARGET
  || `http://localhost:${process.env.PORT || 5000}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      }
    }
  },
})
