import { federation } from '@module-federation/vite';
import { VitePWA } from '@unplugin-pwa/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Every origin listed here gets a runtime-caching rule in the service worker.
const REMOTE_ORIGINS = ['http://localhost:5181'];

// Shared with src/offlineRemotesPlugin.js — the page warms these same caches.
const MANIFEST_CACHE = 'mf-remote-manifests';
const ASSET_CACHE = 'mf-remote-assets';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const remoteRuntimeCaching = REMOTE_ORIGINS.flatMap((origin) => {
  const prefix = escapeRegExp(origin);
  return [
    {
      // The manifest is the only un-hashed file: prefer the network so a new
      // remote deploy is picked up, and fall back to the cached copy offline.
      urlPattern: new RegExp(`^${prefix}/.*mf-manifest\\.json(\\?.*)?$`),
      handler: 'NetworkFirst',
      options: {
        cacheName: MANIFEST_CACHE,
        networkTimeoutSeconds: 3,
        cacheableResponse: { statuses: [0, 200] },
        matchOptions: { ignoreVary: true },
      },
    },
    {
      // remoteEntry-[hash].js and every chunk are content-hashed, so they never
      // change in place: serve from cache once we have them.
      urlPattern: new RegExp(`^${prefix}/.*\\.(?:m?js|css|json|svg|png|woff2?)(\\?.*)?$`),
      handler: 'CacheFirst',
      options: {
        cacheName: ASSET_CACHE,
        cacheableResponse: { statuses: [0, 200] },
        matchOptions: { ignoreVary: true },
        expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },
  ];
});

export default defineConfig({
  server: { port: 5180 },
  preview: { port: 5180 },
  plugins: [
    react(),
    federation({
      name: 'pwaHost',
      remotes: {
        pwaRemote: `${REMOTE_ORIGINS[0]}/mf-manifest.json`,
      },
      dts: false,
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
      },
      runtimePlugins: ['./src/offlineRemotesPlugin.js'],
    }),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'MF PWA offline host',
        short_name: 'MF PWA',
        theme_color: '#646cff',
        icons: [{ src: 'vite.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      generateSW: {
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html}'],
        runtimeCaching: remoteRuntimeCaching,
      },
    }),
  ],
  build: {
    target: 'chrome89',
  },
});
