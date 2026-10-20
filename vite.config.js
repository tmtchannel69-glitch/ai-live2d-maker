import { defineConfig } from 'vite';
export default defineConfig({
  server: { proxy: { '/api/model-build': { target: 'http://127.0.0.1:8001', timeout: 240000 }, '/api': { target: 'http://127.0.0.1:8000', timeout: 180000 } } },
});
