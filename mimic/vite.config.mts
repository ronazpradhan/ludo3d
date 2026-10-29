import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('./client', import.meta.url));
const outDir = fileURLToPath(new URL('../dist/mimic/client', import.meta.url));

// Dev: `npm run dev:mimic` serves the client with hot reload on :5173 and forwards the socket to `npm start` on :3000.
export default defineConfig({
  root,
  base: '/mimic/',
  plugins: [react()],
  build: { outDir, emptyOutDir: true, target: 'es2020', sourcemap: false },
  server: {
    port: 5173,
    proxy: { '/mimic/socket.io': { target: 'http://localhost:3000', ws: true } },
  },
});
