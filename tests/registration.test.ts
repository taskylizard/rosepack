import {
  ApplicationCommandTypes,
  type Client,
  type CreateApplicationCommandOptions
} from 'oceanic.js'
import { expect, test, vi } from 'vite-plus/test'
import { reconcileApplicationCommands } from '../src/registration.ts'

const ping: CreateApplicationCommandOptions = {
  description: 'Check whether the bot responds',
  name: 'ping',
  type: ApplicationCommandTypes.CHAT_INPUT
}

test('creates, updates, and leaves only matching application commands unchanged', async () => {
  const routes = createRoutes([
    { ...ping, description: 'Old description', id: 'ping-id' },
    {
      contexts: [0],
      description: 'Already current',
      id: 'current-id',
      name: 'current',
      nsfw: false,
      type: ApplicationCommandTypes.CHAT_INPUT
    }
  ])
  const current: CreateApplicationCommandOptions = {
    description: 'Already current',
    name: 'current',
    type: ApplicationCommandTypes.CHAT_INPUT
  }
  const created: CreateApplicationCommandOptions = {
    description: 'A new command',
    name: 'created',
    type: ApplicationCommandTypes.CHAT_INPUT
  }

  const result = await reconcileApplicationCommands({
    applicationID: 'application',
    client: createClient(routes),
    payload: [ping, current, created]
  })

  expect(result.map(({ action, name }) => ({ action, name }))).toEqual([
    { action: 'update', name: 'ping' },
    { action: 'unchanged', name: 'current' },
    { action: 'create', name: 'created' }
  ])
  expect(routes.editGlobalCommand).toHaveBeenCalledWith('application', 'ping-id', ping)
  expect(routes.createGlobalCommand).toHaveBeenCalledWith('application', created)
})

test('deletes only missing commands recorded as rosepack-owned', async () => {
  const routes = createRoutes([
    { description: 'Owned', id: 'owned-id', name: 'owned', type: 1 },
    { description: 'Foreign', id: 'foreign-id', name: 'foreign', type: 1 }
  ])

  const result = await reconcileApplicationCommands({
    applicationID: 'application',
    client: createClient(routes),
    deleteMissing: true,
    ownedCommandKeys: new Set(['1:owned']),
    payload: []
  })

  expect(result).toEqual([
    { action: 'delete', id: 'owned-id', key: '1:owned', name: 'owned', type: 1 }
  ])
  expect(routes.deleteGlobalCommand).toHaveBeenCalledWith('application', 'owned-id')
  expect(routes.deleteGlobalCommand).not.toHaveBeenCalledWith('application', 'foreign-id')
})

test('supports dry-run guild reconciliation without sending mutations', async () => {
  const routes = createRoutes([])

  const result = await reconcileApplicationCommands({
    applicationID: 'application',
    client: createClient(routes),
    dryRun: true,
    guildID: 'guild',
    payload: [ping]
  })

  expect(result[0]).toMatchObject({ action: 'create', name: 'ping' })
  expect(routes.getGuildCommands).toHaveBeenCalledWith('application', 'guild')
  expect(routes.createGuildCommand).not.toHaveBeenCalled()
})

test('normalizes Discord snake-case option constraint fields', async () => {
  const constrained: CreateApplicationCommandOptions = {
    description: 'Constrained input',
    name: 'constrained',
    options: [
      {
        description: 'Some text',
        maxLength: 100,
        name: 'text',
        required: true,
        type: 3
      }
    ],
    type: ApplicationCommandTypes.CHAT_INPUT
  }
  const routes = createRoutes([
    {
      description: constrained.description,
      id: 'constrained-id',
      name: constrained.name,
      options: [
        {
          description: 'Some text',
          max_length: 100,
          name: 'text',
          required: true,
          type: 3
        }
      ],
      type: constrained.type
    }
  ])

  const result = await reconcileApplicationCommands({
    applicationID: 'application',
    client: createClient(routes),
    guildID: 'guild',
    payload: [constrained]
  })

  expect(result[0]?.action).toBe('unchanged')
  expect(routes.editGuildCommand).not.toHaveBeenCalled()
})

function createRoutes(commands: readonly Record<string, unknown>[]) {
  return {
    createGlobalCommand: vi.fn(async () => undefined),
    createGuildCommand: vi.fn(async () => undefined),
    deleteGlobalCommand: vi.fn(async () => undefined),
    deleteGuildCommand: vi.fn(async () => undefined),
    editGlobalCommand: vi.fn(async () => undefined),
    editGuildCommand: vi.fn(async () => undefined),
    getGlobalCommands: vi.fn(async () => [...commands]),
    getGuildCommands: vi.fn(async () => [...commands])
  }
}

function createClient(routes: ReturnType<typeof createRoutes>): Client {
  return { rest: { applications: routes } } as unknown as Client
}
