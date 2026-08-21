import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The dev server proxies /api to the API on :3000, so the browser only ever talks to one
 * origin. That keeps CORS out of the server entirely - no middleware, no allow-list, no
 * production difference to explain.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
