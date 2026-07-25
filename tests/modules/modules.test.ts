import { expect, test, vi } from 'vite-plus/test'
import { createRosepack, defineModules, moduleChoices, moduleValues } from '../../src/index.ts'
import {
  createClient,
  createContextMenuInteraction,
  createInteraction,
  createRoutes
} from '../testing.ts'
import { createModuleRosepack, createModuleState, modules, type TestApp } from './testing.ts'

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
  const state = createModuleState()
  const mutate = vi.fn((context: Parameters<typeof state.mutate>[0]) => state.mutate(context))
  const rosepack = createRosepack<TestApp>().withModules({ ...state, mutate })
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
  const routes = createRoutes()
  const app: TestApp = { enabled: [], owned: [] }

  expect(registry.payload.map(({ name }) => name)).toEqual(['modules'])

  const result = await registry.modules.enable({
    app,
    applicationID: 'application',
    client: createClient(routes),
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
  const rosepack = createModuleRosepack({
    async read() {
      return ['missing']
    }
  })
  const music = rosepack.slash({
    description: 'Music',
    module: foreign.music as unknown as (typeof modules)['economy'],
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
  const rosepack = createModuleRosepack()
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
    client: createClient(routes),
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
  const routes = createRoutes()
  routes.createGuildCommand.mockRejectedValueOnce(new Error('Discord unavailable'))
  const rosepack = createModuleRosepack()
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
    client: createClient(routes),
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
  const routes = createRoutes()
  const state = createModuleState()
  const rosepack = createRosepack<TestApp>().withModules({
    ...state,
    async mutate(context) {
      await Promise.resolve()
      return state.mutate(context)
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
    client: createClient(routes),
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
  const routes = createRoutes()
  const state = createModuleState({
    async read({ app }) {
      return [...app.enabled]
    }
  })
  const makeRegistry = () => {
    const rosepack = createRosepack<TestApp>().withModules(state)
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
    client: createClient(routes),
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
  const rosepack = createModuleRosepack({ onDisabled })
  const command = rosepack.slash({
    description: 'Economy',
    execute,
    module: modules.economy,
    name: 'economy'
  })
  const registry = rosepack.createRegistry({ modules, slashCommands: [command] })
  const interaction = createInteraction('economy', [], {
    applicationID: 'application',
    client: {},
    guildID: 'guild'
  })

  await registry.dispatch({ app, interaction })

  expect(execute).not.toHaveBeenCalled()
  expect(onDisabled).toHaveBeenCalledWith({ app, interaction, module: modules.economy })
})

test('blocks stale user and message context-menu interactions', async () => {
  const onDisabled = vi.fn(async () => undefined)
  const userExecute = vi.fn(async () => undefined)
  const messageExecute = vi.fn(async () => undefined)
  const app: TestApp = { enabled: [], owned: [] }
  const rosepack = createModuleRosepack({ onDisabled })
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
    interaction: createContextMenuInteraction('Economy user', 'user')
  })
  await registry.dispatch({
    app,
    interaction: createContextMenuInteraction('Economy message', 'message')
  })

  expect(userExecute).not.toHaveBeenCalled()
  expect(messageExecute).not.toHaveBeenCalled()
  expect(onDisabled).toHaveBeenCalledTimes(2)
})

test('rejects a registry catalog that disagrees with the state adapter catalog', () => {
  const other = defineModules({ economy: { label: 'Different label' } })
  const rosepack = createModuleRosepack()

  expect(() => rosepack.createRegistry({ modules: other as unknown as typeof modules })).toThrow(
    'same rosepack module catalog'
  )
})
