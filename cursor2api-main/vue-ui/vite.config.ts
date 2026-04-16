import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const isProd = process.env.NODE_ENV === 'production';

export default defineConfig({
  plugins: [vue()],
  base: isProd ? '/public/vue/' : '/',
  build: {
    outDir: '../public/vue',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3010', changeOrigin: true },
    },
  },
});
