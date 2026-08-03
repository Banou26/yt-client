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
        enumsAsTypes: true,
      },
    },
    './src/generated/resolvers.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        contextType: '../worker/yoga#ServerContext',
        mappers: {
          SearchResult: '../sources/types#SourceSearchResult',
        },
        useTypeImports: true,
        // a TS enum member is not assignable from its own string value, which breaks `satisfies Resolvers` against src/sources/types.ts
        enumsAsTypes: true,
      },
    },
  },
} satisfies CodegenConfig

export default config
