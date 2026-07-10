import type { CodegenConfig } from '@graphql-codegen/cli'

const config = {
  schema: './src/worker/schema.gql',
  documents: ['src/**/*.ts', 'src/**/*.tsx'],
  ignoreNoDocuments: true,
  generates: {
    './src/generated/': {
      preset: 'client',
      presetConfig: {
        fragmentMasking: false,
        gqlTagName: 'gql',
      },
      config: {
        useTypeImports: true,
      },
    },
    './src/generated/resolvers.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        contextType: '../worker/yoga#ServerContext',
        useTypeImports: true,
      },
    },
  },
} satisfies CodegenConfig

export default config
