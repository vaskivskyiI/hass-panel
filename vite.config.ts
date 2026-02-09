import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const haUrl = env.VITE_HA_URL
  const useProxy = env.VITE_HA_PROXY === 'true' && Boolean(haUrl)

  return {
    plugins: [react()],
    server: useProxy
      ? {
          proxy: {
            '/api': {
              target: haUrl,
              changeOrigin: true,
              secure: false,
            },
          },
        }
      : undefined,
  }
})
