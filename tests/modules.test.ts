import { ApplicationCommandTypes, CommandInteraction, type Client } from 'oceanic.js'
import { expect, test, vi } from 'vite-plus/test'
import { createRosepack, defineModules, moduleChoices, moduleValues } from '../src/index.ts'

interface TestApp {
  enabled: string[]
  owned: `${number}:${string}`[]
}

const modules = defineModules({
  economy: { label: '🍣 Economy' },
  moderation: { description: 'Server moderation tools', label: '🔨 Moderation' }
})

test('defines one frozen source of truth for module references and choices', () => {
  expect(moduleValues(modules)).toEqual([
    { id: 'economy', label: '🍣 Economy' },
    { description: 'Server moderation tools', id: 'moderation', label: '🔨 Moderation' }
  ])
  expect(moduleChoices(modules)).toEqual([
    { name: '🍣 Economy', value: 'economy' },
    { name: '🔨 Moderation', value: 'moderation' }
  ])
  expect(Object.isFrozen(modules.economy)).toBe(true)
})

test('excludes modular commands globally and reconciles every command in an enabled module', async () => {
  const mutate = vi.fn(
    async ({ app, enabled, module }: { app: TestApp; enabled: boolean; module: string }) => {
      const before = app.enabled.includes(module)
      app.enabled = enabled
        ? [...new Set([...app.enabled, module])]
        : app.enabled.filter((id) => id !== module)
      return { changed: before !== enabled, modules: [...app.enabled] }
    }
  )
  const rosepack = createRosepack<TestApp>({
    modules: {
      catalog: modules,
      async read({ app }) {
        return app.enabled
      },
      async readOwnedCommandKeys({ app }) {
        return app.owned
      },
      async writeOwnedCommandKeys({ app, keys }) {
        app.owned = [...keys]
      },
      mutate
    }
  })
  const economy = rosepack.slash({
    description: 'Server economy',
    module: modules.economy,
    name: 'economy',
    async execute() {}
  })
  const balance = rosepack.userMenu({
    module: modules.economy,
    name: 'View balance',
    async execute() {}
  })
  const modulesCommand = rosepack.slash({
    description: 'Manage modules',
    name: 'modules',
    async execute() {}
  })
  const registry = rosepack.createRegistry({
    modules,
    slashCommands: [economy, modulesCommand],
    userContextMenus: [balance]
  })
  const routes = createRoutes([])
  const app: TestApp = { enabled: [], owned: [] }

  expect(registry.payload.map(({ name }) => name)).toEqual(['modules'])

  const result = await registry.modules.enable({
    app,
    applicationID: 'application',
    client: { rest: { applications: routes } } as unknown as Client,
    guildID: 'guild',
    module: 'economy'
  })

  expect(result.changed).toBe(true)
  expect(result.enabled).toEqual([modules.economy])
  expect(app.enabled).toEqual(['economy'])
  expect(mutate).toHaveBeenCalledOnce()
  expect(routes.createGuildCommand).toHaveBeenCalledTimes(2)
  const calls = routes.createGuildCommand.mock.calls as unknown as readonly [
    string,
    string,
    { readonly name: string }
  ][]
  expect(calls.map((call) => call[2].name)).toEqual(['economy', 'View balance'])
})

test('rejects persisted IDs and command references outside the configured catalog', async () => {
  const foreign = defineModules({ music: { label: '🎵 Music' } })
  const rosepack = createRosepack<TestApp>({
    modules: {
      catalog: modules,
      async read() {
        return ['missing']
      },
      async readOwnedCommandKeys() {
        return []
      },
      async writeOwnedCommandKeys() {},
      async mutate({ app }) {
        return { changed: false, modules: [...app.enabled] }
      }
    }
  })
  const music = rosepack.slash({
    description: 'Music',
    module: foreign.music,
    name: 'music',
    async execute() {}
  })

  expect(() => rosepack.createRegistry({ slashCommands: [music] })).toThrow(
    'unknown rosepack module "music"'
  )

  const registry = rosepack.createRegistry({ modules, slashCommands: [] })
  await expect(
    registry.modules.list({
      app: { enabled: [], owned: [] },
      applicationID: 'application',
      guildID: 'guild'
    })
  ).rejects.toThrow('Unknown rosepack module "missing"')
})

test('retries synchronization for an already persisted module and deletes formerly owned commands', async () => {
  const app: TestApp = { enabled: ['economy'], owned: ['1:removed'] }
  const routes = createRoutes([
    { description: 'Removed', id: 'removed-id', name: 'removed', type: 1 }
  ])
  const rosepack = createRosepack<TestApp>({
    modules: {
      catalog: modules,
      async read({ app }) {
        return app.enabled
      },
      async readOwnedCommandKeys({ app }) {
        return app.owned
      },
      async mutate({ app, enabled, module }) {
        const before = app.enabled.includes(module)
        app.enabled = enabled
          ? [...new Set([...app.enabled, module])]
          : app.enabled.filter((id) => id !== module)
        return { changed: before !== enabled, modules: [...app.enabled] }
      },
      async writeOwnedCommandKeys({ app, keys }) {
        app.owned = [...keys]
      }
    }
  })
  const economy = rosepack.slash({
    description: 'Economy',
    module: modules.economy,
    name: 'economy',
    async execute() {}
  })
  const registry = rosepack.createRegistry({ modules, slashCommands: [economy] })

  const result = await registry.modules.enable({
    app,
    applicationID: 'application',
    client: { rest: { applications: routes } } as unknown as Client,
    guildID: 'guild',
    module: 'economy'
  })

  expect(result.changed).toBe(false)
  expect(result.registration.map(({ action, name }) => ({ action, name }))).toEqual([
    { action: 'create', name: 'economy' },
    { action: 'delete', name: 'removed' }
  ])
  expect(routes.deleteGuildCommand).toHaveBeenCalledWith('application', 'guild', 'removed-id')
  expect(app.owned).toEqual(['1:economy'])
})

test('retries Discord synchronization when a persisted no-op toggle previously failed', async () => {
  const app: TestApp = { enabled: ['economy'], owned: [] }
  const routes = createRoutes([])
  routes.createGuildCommand.mockRejectedValueOnce(new Error('Discord unavailable'))
  const rosepack = createRosepack<TestApp>({
    modules: {
      catalog: modules,
      async read({ app }) {
        return app.enabled
      },
      async mutate({ app, enabled, module }) {
        const changed = app.enabled.includes(module) !== enabled
        app.enabled = enabled
          ? [...new Set([...app.enabled, module])]
          : app.enabled.filter((id) => id !== module)
        return { changed, modules: [...app.enabled] }
      },
      async readOwnedCommandKeys({ app }) {
        return app.owned
      },
      async writeOwnedCommandKeys({ app, keys }) {
        app.owned = [...keys]
      }
    }
  })
  const economy = rosepack.slash({
    description: 'Economy',
    module: modules.economy,
    name: 'economy',
    async execute() {}
  })
  const registry = rosepack.createRegistry({ modules, slashCommands: [economy] })
  const config = {
    app,
    applicationID: 'application',
    client: { rest: { applications: routes } } as unknown as Client,
    guildID: 'guild',
    module: 'economy'
  } as const

  await expect(registry.modules.enable(config)).rejects.toMatchObject({
    name: 'ModuleSynchronizationError'
  })
  const result = await registry.modules.enable(config)

  expect(result.changed).toBe(false)
  expect(result.registration[0]?.action).toBe('create')
  expect(routes.createGuildCommand).toHaveBeenCalledTimes(2)
  expect(app.owned).toEqual(['1:economy'])
})

test('serializes concurrent mutations for one application and guild', async () => {
  const app: TestApp = { enabled: [], owned: [] }
  const routes = createRoutes([])
  const rosepack = createRosepack<TestApp>({
    modules: {
      catalog: modules,
      async read({ app }) {
        return app.enabled
      },
      async readOwnedCommandKeys({ app }) {
        return app.owned
      },
      async mutate({ app, enabled, module }) {
        await Promise.resolve()
        const before = app.enabled.includes(module)
        app.enabled = enabled
          ? [...new Set([...app.enabled, module])]
          : app.enabled.filter((id) => id !== module)
        return { changed: before !== enabled, modules: [...app.enabled] }
      },
      async writeOwnedCommandKeys({ app, keys }) {
        app.owned = [...keys]
      }
    }
  })
  const commands = moduleValues(modules).map((module) =>
    rosepack.slash({
      description: module.label,
      module,
      name: module.id,
      async execute() {}
    })
  )
  const registry = rosepack.createRegistry({ modules, slashCommands: commands })
  const config = {
    app,
    applicationID: 'application',
    client: { rest: { applications: routes } } as unknown as Client,
    guildID: 'guild'
  }

  await Promise.all([
    registry.modules.enable({ ...config, module: 'economy' }),
    registry.modules.enable({ ...config, module: 'moderation' })
  ])

  expect(app.enabled).toEqual(['economy', 'moderation'])
})

test('supports concurrent mutations from separate registries with an atomic adapter', async () => {
  const app: TestApp = { enabled: [], owned: [] }
  const routes = createRoutes([])
  const state = {
    catalog: modules,
    async read({ app }: { app: TestApp }) {
      return [...app.enabled]
    },
    async mutate({ app, enabled, module }: { app: TestApp; enabled: boolean; module: string }) {
      const before = app.enabled.includes(module)
      app.enabled = enabled
        ? [...new Set([...app.enabled, module])]
        : app.enabled.filter((id) => id !== module)
      return { changed: before !== enabled, modules: [...app.enabled] }
    },
    async readOwnedCommandKeys({ app }: { app: TestApp }) {
      return app.owned
    },
    async writeOwnedCommandKeys({
      app,
      keys
    }: {
      app: TestApp
      keys: readonly `${number}:${string}`[]
    }) {
      app.owned = [...keys]
    }
  }
  const makeRegistry = () => {
    const rosepack = createRosepack<TestApp>({ modules: state })
    const commands = moduleValues(modules).map((module) =>
      rosepack.slash({
        description: module.label,
        module,
        name: module.id,
        async execute() {}
      })
    )
    return rosepack.createRegistry({ modules, slashCommands: commands })
  }
  const first = makeRegistry()
  const second = makeRegistry()
  const config = {
    app,
    applicationID: 'application',
    client: { rest: { applications: routes } } as unknown as Client,
    guildID: 'guild'
  }

  await Promise.all([
    first.modules.enable({ ...config, module: 'economy' }),
    second.modules.enable({ ...config, module: 'moderation' })
  ])

  expect(app.enabled).toEqual(['economy', 'moderation'])
})

test('blocks stale interactions after a module is disabled', async () => {
  const onDisabled = vi.fn(async () => undefined)
  const execute = vi.fn(async () => undefined)
  const app: TestApp = { enabled: [], owned: [] }
  const rosepack = createRosepack<TestApp>({
    modules: {
      catalog: modules,
      onDisabled,
      async read({ app }) {
        return app.enabled
      },
      async readOwnedCommandKeys({ app }) {
        return app.owned
      },
      async mutate({ app }) {
        return { changed: false, modules: [...app.enabled] }
      },
      async writeOwnedCommandKeys() {}
    }
  })
  const command = rosepack.slash({
    description: 'Economy',
    execute,
    module: modules.economy,
    name: 'economy'
  })
  const registry = rosepack.createRegistry({ modules, slashCommands: [command] })
  const interaction = Object.assign(Object.create(CommandInteraction.prototype), {
    applicationID: 'application',
    client: {},
    data: { name: 'economy', options: { raw: [] } },
    guildID: 'guild',
    isChatInputCommand: () => true,
    isMessageCommand: () => false,
    isUserCommand: () => false
  }) as CommandInteraction

  await registry.dispatch({ app, interaction })

  expect(execute).not.toHaveBeenCalled()
  expect(onDisabled).toHaveBeenCalledWith({ app, interaction, module: modules.economy })
})

test('blocks stale user and message context-menu interactions', async () => {
  const onDisabled = vi.fn(async () => undefined)
  const userExecute = vi.fn(async () => undefined)
  const messageExecute = vi.fn(async () => undefined)
  const app: TestApp = { enabled: [], owned: [] }
  const rosepack = createRosepack<TestApp>({
    modules: {
      catalog: modules,
      onDisabled,
      async read({ app }) {
        return app.enabled
      },
      async mutate({ app }) {
        return { changed: false, modules: [...app.enabled] }
      },
      async readOwnedCommandKeys() {
        return []
      },
      async writeOwnedCommandKeys() {}
    }
  })
  const user = rosepack.userMenu({
    module: modules.economy,
    name: 'Economy user',
    async execute() {
      await userExecute()
    }
  })
  const message = rosepack.messageMenu({
    module: modules.economy,
    name: 'Economy message',
    async execute() {
      await messageExecute()
    }
  })
  const registry = rosepack.createRegistry({
    modules,
    messageContextMenus: [message],
    userContextMenus: [user]
  })

  await registry.dispatch({
    app,
    interaction: createMenuInteraction('Economy user', 'user')
  })
  await registry.dispatch({
    app,
    interaction: createMenuInteraction('Economy message', 'message')
  })

  expect(userExecute).not.toHaveBeenCalled()
  expect(messageExecute).not.toHaveBeenCalled()
  expect(onDisabled).toHaveBeenCalledTimes(2)
})

test('rejects a registry catalog that disagrees with the state adapter catalog', () => {
  const other = defineModules({ economy: { label: 'Different label' } })
  const rosepack = createRosepack<TestApp>({
    modules: {
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
    }
  })

  expect(() => rosepack.createRegistry({ modules: other })).toThrow('same rosepack module catalog')
})

function createRoutes(commands: readonly Record<string, unknown>[]) {
  return {
    createGuildCommand: vi.fn(async () => undefined),
    deleteGuildCommand: vi.fn(async () => undefined),
    editGuildCommand: vi.fn(async () => undefined),
    getGuildCommands: vi.fn(async () => [...commands]),
    getGlobalCommands: vi.fn(async () => []),
    createGlobalCommand: vi.fn(async () => undefined),
    deleteGlobalCommand: vi.fn(async () => undefined),
    editGlobalCommand: vi.fn(async () => undefined)
  }
}

function createMenuInteraction(name: string, kind: 'message' | 'user'): CommandInteraction {
  return Object.assign(Object.create(CommandInteraction.prototype), {
    applicationID: 'application',
    client: {},
    data: { name, target: { id: `${kind}-target` } },
    guildID: 'guild',
    isChatInputCommand: () => false,
    isMessageCommand: () => kind === 'message',
    isUserCommand: () => kind === 'user'
  }) as CommandInteraction
}

test('module payloads preserve Discord command types', () => {
  const rosepack = createRosepack<TestApp>()
  const command = rosepack.slash({
    description: 'Economy',
    module: modules.economy,
    name: 'economy',
    async execute() {}
  })

  expect(() => rosepack.createRegistry({ modules, slashCommands: [command] })).not.toThrow()
  expect(ApplicationCommandTypes.CHAT_INPUT).toBe(1)
})
