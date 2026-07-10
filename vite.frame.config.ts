import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: false,
    lib: {
      entry: fromRoot('./src/frame/index.ts'),
      formats: ['iife'],
      name: 'YtClientFrame',
      fileName: () => 'youtube-frame.js',
    },
    outDir: 'public/__yt_scramjet__',
    target: 'esnext',
  },
})
