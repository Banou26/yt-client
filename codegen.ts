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
        useTypeImports: true,
        // String-literal unions rather than TS enums, so the hand-written
        // Source types in src/sources/types.ts stay structurally compatible
        // with the generated ones (a TS enum member is not assignable from its
        // own string value, which breaks `satisfies Resolvers` for every field
        // that touches an enum). It also keeps the enum out of the bundle.
        enumsAsTypes: true,
      },
    },
  },
} satisfies CodegenConfig

export default config
