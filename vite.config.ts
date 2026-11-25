import { defineConfig } from 'vitest/config';

export default defineConfig({
  // caminho relativo: o build funciona servido de qualquer subpasta (ex.: GitHub Pages)
  base: './',
  server: { port: 5173, strictPort: true },
  worker: { format: 'es' },
  // o Three.js sozinho tem ~550 kB; não vale a pena dividir em pedaços
  build: { chunkSizeWarningLimit: 800 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
