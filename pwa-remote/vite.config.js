import { federation } from '@module-federation/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const origin = 'http://localhost:5181';

export default defineConfig({
  server: { port: 5181, origin, cors: true },
  preview: { port: 5181, cors: true },
  base: `${origin}/`,
  plugins: [
    react(),
    federation({
      name: 'pwaRemote',
      filename: 'remoteEntry-[hash].js',
      manifest: true,
      dts: false,
      exposes: {
        './Widget': './src/Widget.jsx',
      },
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
      },
    }),
  ],
  build: {
    target: 'chrome89',
  },
});
