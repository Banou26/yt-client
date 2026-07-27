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
        // A union's __resolveType has to read something the schema does not
        // declare. Mapping SearchResult onto the discriminated source type is
        // what lets that stay type-checked instead of casting: the resolver
        // sees the `kind` tag, and each member still carries the entity's own
        // fields at the top level so default field resolution works unchanged.
        mappers: {
          SearchResult: '../sources/types#SourceSearchResult',
        },
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
