import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const haUrl = env.VITE_HA_URL
  const useProxy = env.VITE_HA_PROXY === 'true' && Boolean(haUrl)

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false,
        includeAssets: ['icon-192.svg', 'icon-512.svg'],
        manifest: {
          name: 'NM Studio Panel',
          short_name: 'Studio Panel',
          description:
            'Touch-first Home Assistant control panel for phones and tablets.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#0b1016',
          theme_color: '#101b24',
          icons: [
            {
              src: '/icon-192.svg',
              sizes: '192x192',
              type: 'image/svg+xml',
              purpose: 'any',
            },
            {
              src: '/icon-512.svg',
              sizes: '512x512',
              type: 'image/svg+xml',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,ico,png}'],
          globIgnores: ['**/runtime-config.json'],
          clientsClaim: true,
          skipWaiting: true,
          cleanupOutdatedCaches: true,
          navigateFallbackDenylist: [/^\/api\//],
        },
        devOptions: {
          enabled: true,
        },
      }),
    ],
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
