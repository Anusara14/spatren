import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Build number (minutes since 1970): baked into the code and into dist/build.txt so scripts/ota.mjs can publish the
// Android over-the-air update under the same number. The app updates when the published number is higher than its own.
const BUILD = Math.floor(Date.now() / 60_000)

export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [
    { name: 'spatren-build-number', generateBundle() { this.emitFile({ type: 'asset', fileName: 'build.txt', source: String(BUILD) }) } },
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'mark.svg', 'mark-dark.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'SPATREN Field',
        short_name: 'SPATREN',
        description: 'Urban & spatial fieldwork: live team map, observations, SOS.',
        theme_color: '#13283C',
        background_color: '#EEF2F4',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/auth/],
        runtimeCaching: [
          {
            // ponytail: basemap tiles cached as you browse; a pre-downloaded PMTiles extract is the upgrade for true offline maps
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\//,
            handler: 'CacheFirst',
            options: { cacheName: 'map-tiles', expiration: { maxEntries: 4000, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            urlPattern: /^https:\/\/api\.dicebear\.com\//,
            handler: 'CacheFirst',
            options: { cacheName: 'avatars', expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 60 } },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
})
