import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolveCloudEnvironment } from './src/shared/cloudEnvironment'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [
      react(),
      {
        name: 'validate-supabase-environment',
        configResolved({ env }) {
          resolveCloudEnvironment(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY)
        }
      }
    ]
  }
})
