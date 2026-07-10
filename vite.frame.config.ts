import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite-plus'

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  fmt: { semi: false, singleQuote: true },
  lint: {
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        files: ['tests/**', '**/*.spec.ts', '**/*.test.ts', 'examples/**'],
        rules: {
          'no-floating-promises': 'off',
          'no-unused-vars': 'off',
          'no-unused-expressions': 'off',
        },
      },
    ],
  },
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
