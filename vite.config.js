import { defineConfig } from 'vite';
const apiPort=Number(process.env.AI_LIVE2D_API_PORT||8000);
if(!Number.isInteger(apiPort)||apiPort<1||apiPort>65535)throw new Error('AI_LIVE2D_API_PORT must be a valid local port.');
const apiTarget=`http://127.0.0.1:${apiPort}`;
export default defineConfig({
  // The PSD exporter is imported only when a web worker starts. Pre-optimizing
  // its dependencies avoids a late Vite dependency-discovery full page reload.
  optimizeDeps: {include: ['ag-psd', 'fast-png', 'fflate']},
  server: { proxy: { '/api/model-build': { target: 'http://127.0.0.1:8001', timeout: 240000 }, '/api/inochi2d': { target: apiTarget, timeout: 660000, proxyTimeout: 660000 }, '/api': { target: apiTarget, timeout: 180000 } } },
});
