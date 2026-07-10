import { fileURLToPath } from 'node:url'

import { defineConfig, lazyPlugins } from 'vite-plus'
import preact from '@preact/preset-vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { viteStaticCopy } from 'vite-plugin-static-copy'

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
  build: {
    outDir: 'build',
    target: 'esnext',
    rollupOptions: {
      input: {
        app: fromRoot('./index.html'),
        engine: fromRoot('./__yt_scramjet__/host.html'),
      },
    },
  },
  plugins: lazyPlugins(() => [
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
    }),
    preact({
      jsxImportSource: '@emotion/react',
    }),
    viteStaticCopy({
      structured: false,
      targets: [
        {
          src: fromRoot('./node_modules/@mercuryworkshop/scramjet/dist/*'),
          dest: '__yt_scramjet__/scramjet',
        },
        {
          src: fromRoot('./node_modules/@mercuryworkshop/scramjet-controller/dist/*'),
          dest: '__yt_scramjet__/controller',
        },
      ],
    }),
  ]),
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
    plugins: () => [
      nodePolyfills({
        globals: { Buffer: true, global: true, process: true },
      }),
    ],
  },
})
