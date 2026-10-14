import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  publicDir: 'public-herdr',
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@openchamber/sdk/schemas', replacement: path.join(root, '../sdk/src/schemas.ts') },
      { find: '@openchamber/sdk', replacement: path.join(root, '../sdk/src/index.ts') },
      { find: '@openchamber/ui', replacement: path.join(root, '../ui/src') },
      { find: '@web', replacement: path.join(root, 'src') },
      { find: '@', replacement: path.join(root, '../ui/src') },
    ],
  },
  define: { 'process.env': {}, global: 'globalThis', __APP_VERSION__: JSON.stringify('0.1.0') },
  server: {
    host: '127.0.0.1',
    port: 5180,
    proxy: { '/api': 'http://127.0.0.1:4318', '/health': 'http://127.0.0.1:4318' },
  },
  build: {
    outDir: 'dist-herdr',
    emptyOutDir: true,
    rollupOptions: { input: path.join(root, 'herdr.html') },
  },
});
