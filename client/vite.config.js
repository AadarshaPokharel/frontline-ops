import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Production files are served by Django/WhiteNoise under /static/; `npm run dev` proxies the API and game socket.
// Game rules live in ../shared so the Node game server runs exactly the same code.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/static/' : '/',
  resolve: { alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) } },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 600,   // three.js is one ~525 kB chunk on purpose, so browsers cache it separately
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
  server: {
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://127.0.0.1:8000', '/ws': { target: 'ws://127.0.0.1:8081', ws: true } },
  },
}));
