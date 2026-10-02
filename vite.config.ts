import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// 画面に出すバージョン（package.json の version）とビルドした日
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

const api = `http://127.0.0.1:${process.env.PORT || 3210}`;
// 公開するパス（例: BASE_PATH=/video-creator）。サーバー側（server/env.ts）と同じ値でビルドする
const basePath = (process.env.BASE_PATH || '').trim().replace(/^\/*/, '/').replace(/\/+$/, '');

export default defineConfig({
  base: `${basePath}/`,
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
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
