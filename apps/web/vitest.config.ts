import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Cada archivo levanta su propia base en memoria; compartir proceso haria
    // que se pisaran la conexion, que es un modulo con estado.
    fileParallelism: false,
  },
});
