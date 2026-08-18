import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: { lib: { entry: resolve('apps/desktop/src/main/index.ts') } }
  },
  preload: {
    build: { lib: { entry: resolve('apps/desktop/src/preload/index.ts') } }
  },
  renderer: {
    root: resolve('apps/desktop/src/renderer'),
    resolve: { alias: { '@renderer': resolve('apps/desktop/src/renderer') } },
    plugins: [react()],
    build: { rollupOptions: { input: resolve('apps/desktop/src/renderer/index.html') } }
  }
})
