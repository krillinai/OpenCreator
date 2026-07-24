import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/bootstrap'),
  base: './',
  build: {
    outDir: resolve(import.meta.dirname, 'dist/bootstrap'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'src/bootstrap/index.html')
    }
  }
});
