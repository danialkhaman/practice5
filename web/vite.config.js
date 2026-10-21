import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envDir: '..', // один .env в корне репозитория (переменные VITE_*)
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  // ethers v6 целиком ~500 КБ: предупреждение о размере чанка поднимаем, чтобы не засорять журнал CI
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 800 },
});
