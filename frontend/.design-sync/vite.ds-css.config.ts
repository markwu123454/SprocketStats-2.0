import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

// Compiles .design-sync/ds.css (app theme + design-system safelist) on its own,
// without touching the app's production build.
export default defineConfig({
  root: resolve(__dirname, '..'),
  plugins: [tailwindcss()],
  build: {
    outDir: resolve(__dirname, '.cache/tw'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'ds-css-entry.ts'),
      output: { assetFileNames: 'ds[extname]' },
    },
  },
})
