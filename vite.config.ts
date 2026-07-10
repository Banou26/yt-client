import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

export default defineConfig({
  build: {
    outDir: 'build',
    target: 'esnext',
  },
  plugins: [
    preact({
      jsxImportSource: '@emotion/react',
    }),
  ],
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
      'react/jsx-dev-runtime': 'preact/jsx-runtime',
    },
    dedupe: ['osra', 'preact'],
  },
  worker: {
    format: 'es',
  },
})
