import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = `http://127.0.0.1:${process.env.PORT || 3210}`;
// 公開するパス（例: BASE_PATH=/video-creator）。サーバー側（server/env.ts）と同じ値でビルドする
const basePath = (process.env.BASE_PATH || '').trim().replace(/^\/*/, '/').replace(/\/+$/, '');

export default defineConfig({
  base: `${basePath}/`,
  plugins: [react()],
  publicDir: 'public',
  server: {
    port: 5173,
    proxy: { [`${basePath}/api`]: api, [`${basePath}/files`]: api, [`${basePath}/auth`]: api },
    watch: {
      ignored: ['**/SUSHI UI/**', '**/projects/**', '**/voices/**', '**/node_modules/**'],
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 4000 },
});
