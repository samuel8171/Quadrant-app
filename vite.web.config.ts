import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveCloudEnvironment } from './src/shared/cloudEnvironment'

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [
    react(),
    {
      name: 'validate-supabase-environment',
      configResolved({ env }) {
        resolveCloudEnvironment(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY)
      }
    }
  ],
  build: {
    outDir: '../../dist-web',
    emptyOutDir: true
  }
})
