import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';

/**
 * Автономная сборка: один самодостаточный HTML-файл.
 * Внутри — интерфейс, расчёт и генератор xlsx. Ни сервера, ни сети.
 * Годится и как локальный файл (двойной клик), и как Mini App на статическом хостинге.
 */
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: { '@shared': path.resolve(__dirname, '../shared') },
  },
  define: {
    'import.meta.env.VITE_STANDALONE': JSON.stringify('1'),
  },
  build: {
    outDir: 'dist-standalone',
    emptyOutDir: true,
    sourcemap: false,
    // Всё в один файл: без отдельных чанков и ассетов
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
