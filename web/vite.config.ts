import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// O build vai direto para ../public, que é servido pelo servidor Node.
export default defineConfig({
  plugins: [react()],
  build: { outDir: '../public', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
