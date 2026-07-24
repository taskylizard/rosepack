import { expectTypeOf, test } from 'vite-plus/test'
import { createRosepack, defineModules, moduleChoices } from '../src/index.ts'

const modules = defineModules({
  economy: { label: '🍣 Economy' },
  moderation: { label: '🔨 Moderation' }
})

test('preserves exact IDs through module references, choices, and slash options', () => {
  expectTypeOf(modules.economy.id).toEqualTypeOf<'economy'>()
  expectTypeOf<ReturnType<typeof moduleChoices<typeof modules>>[number]['value']>().toEqualTypeOf<
    'economy' | 'moderation'
  >()

  const { slash } = createRosepack<{}>()
  slash({
    description: 'Manage modules',
    name: 'modules',
    options: {
      module: {
        choices: moduleChoices(modules),
        description: 'Module to enable',
        kind: 'string',
        required: true
      }
    },
    async execute(context) {
      expectTypeOf(context.options.module).toEqualTypeOf<'economy' | 'moderation'>()
    }
  })
})

test('carries the exact catalog through withModules and rejects unknown selectors', () => {
  const rosepack = createRosepack<{}>().withModules({
    catalog: modules,
    async read() {
      return []
    },
    async mutate() {
      return { changed: false, modules: [] }
    },
    async readOwnedCommandKeys() {
      return []
    },
    async writeOwnedCommandKeys() {}
  })

  rosepack.slash({
    description: 'Manage modules',
    name: 'modules',
    options: {
      module: {
        choices: moduleChoices(modules),
        description: 'Module to enable',
        kind: 'string',
        required: true
      }
    },
    async execute(context) {
      void context.modules.enable(modules.economy)
      expectTypeOf(context.options.module).toEqualTypeOf<'economy' | 'moderation'>()
      // @ts-expect-error Unknown IDs must not be accepted by a catalog-bound context.
      void context.modules.enable('missing')
    }
  })
})

test('retains the catalog through file, subcommand, and context-menu builders', () => {
  const rosepack = createRosepack<{}>().withModules({
    catalog: modules,
    async read() {
      return []
    },
    async mutate() {
      return { changed: false, modules: [] }
    },
    async readOwnedCommandKeys() {
      return []
    },
    async writeOwnedCommandKeys() {}
  })

  const subcommand = rosepack.slashSub({
    description: 'Child',
    async execute(context) {
      void context.modules.enable(modules.moderation)
      // @ts-expect-error Subcommand contexts must reject IDs outside the catalog.
      void context.modules.enable('missing')
    }
  })
  const command = rosepack.slashFile({
    description: 'File command',
    module: modules.economy,
    async execute(context) {
      void context.modules.enable(modules.economy)
      // @ts-expect-error File command contexts must reject IDs outside the catalog.
      void context.modules.enable('missing')
    }
  })
  const menu = rosepack.userMenu({
    module: modules.moderation,
    name: 'Moderation user',
    async execute(context) {
      void context.modules.enable(modules.moderation)
      // @ts-expect-error Context-menu contexts must reject IDs outside the catalog.
      void context.modules.enable('missing')
    }
  })

  expectTypeOf(command.module?.id).toEqualTypeOf<'economy' | 'moderation' | undefined>()
  expectTypeOf(menu.module?.id).toEqualTypeOf<'economy' | 'moderation' | undefined>()
  expectTypeOf<typeof subcommand.execute>().toBeFunction()
})
