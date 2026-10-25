import { defineConfig } from 'vite';
export default defineConfig({
  // The PSD exporter is imported only when a web worker starts. Pre-optimizing
  // its dependencies avoids a late Vite dependency-discovery full page reload.
  optimizeDeps: {include: ['ag-psd', 'fast-png', 'fflate']},
  server: { proxy: { '/api/model-build': { target: 'http://127.0.0.1:8001', timeout: 240000 }, '/api': { target: 'http://127.0.0.1:8000', timeout: 180000 } } },
});