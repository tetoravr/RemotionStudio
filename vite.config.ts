import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = `http://localhost:${process.env.PORT || 3210}`;

export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  server: {
    port: 5173,
    proxy: { '/api': api, '/files': api },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 4000 },
});
