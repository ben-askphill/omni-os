import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  server: {
    port: 4748,
    proxy: { '/api': { target: 'http://127.0.0.1:4747', changeOrigin: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
