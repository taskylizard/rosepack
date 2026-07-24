import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ApplicationCommandTypes, type Client } from 'oceanic.js'
import { expect, test, vi } from 'vite-plus/test'
import { parseRegistrationCliOptions, runRegistrationCli } from '../src/registration-cli.ts'

test('parses guild, cache, and dry-run registration options', () => {
  expect(
    parseRegistrationCliOptions(
      ['register', '--guild', '123', '--cache', 'state.json', '--module', 'economy', '--dry-run'],
      {
        DISCORD_APPLICATION_ID: 'application',
        DISCORD_TOKEN: 'token'
      }
    )
  ).toEqual({
    command: 'register',
    applicationID: 'application',
    cacheFile: resolve('state.json'),
    dryRun: true,
    guildID: '123',
    modules: ['economy'],
    token: 'token'
  })
})

test('lists manifest modules without Discord credentials', async () => {
  const output: string[] = []
  const info = vi.spyOn(console, 'info').mockImplementation((value) => {
    output.push(String(value))
  })

  try {
    await runRegistrationCli({
      arguments: ['modules', 'list'],
      modules: [
        { description: 'Optional economy features', id: 'economy', label: '🍣 Economy' },
        { id: 'moderation', label: '🔨 Moderation' }
      ],
      environment: {}
    })
  } finally {
    info.mockRestore()
  }

  expect(output).toEqual([
    'economy\t🍣 Economy — Optional economy features',
    'moderation\t🔨 Moderation'
  ])
})

test('filters global and guild registration payloads by module ownership', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rosepack-registration-'))
  const cacheFile = join(directory, 'registration.json')
  const routes = createRoutes()
  const client = { rest: { applications: routes } } as unknown as Client
  const commands = [
    { payload: commandPayload('global') },
    { module: 'economy', payload: commandPayload('economy') },
    { module: 'moderation', payload: commandPayload('moderation') }
  ]
  const environment = { DISCORD_APPLICATION_ID: 'application', DISCORD_TOKEN: 'token' }

  await runRegistrationCli({
    arguments: ['register', '--cache', cacheFile],
    client,
    commands,
    environment
  })
  expect(routes.createGlobalCommand).toHaveBeenCalledWith('application', commandPayload('global'))

  routes.createGuildCommand.mockClear()
  await runRegistrationCli({
    arguments: ['register', '--guild', 'guild', '--module', 'economy', '--cache', cacheFile],
    client,
    commands,
    environment,
    modules: [
      { id: 'economy', label: 'Economy' },
      { id: 'moderation', label: 'Moderation' }
    ]
  })
  expect(routes.createGuildCommand).toHaveBeenCalledWith(
    'application',
    'guild',
    expect.objectContaining({ name: 'economy' })
  )
  expect(routes.createGuildCommand).toHaveBeenCalledTimes(1)
})

test('migrates v1 registration ownership into an application-scoped cache', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rosepack-registration-'))
  const cacheFile = join(directory, 'registration.json')
  await writeFile(cacheFile, JSON.stringify({ version: 1, scopes: { 'guild:guild': ['1:old'] } }))
  const routes = createRoutes([
    { id: 'old-id', name: 'old', type: ApplicationCommandTypes.CHAT_INPUT }
  ])

  await runRegistrationCli({
    arguments: ['register', '--guild', 'guild', '--cache', cacheFile],
    client: { rest: { applications: routes } } as unknown as Client,
    commands: [],
    environment: { DISCORD_APPLICATION_ID: 'application', DISCORD_TOKEN: 'token' }
  })

  expect(routes.deleteGuildCommand).toHaveBeenCalledWith('application', 'guild', 'old-id')
  const cache = JSON.parse(await readFile(cacheFile, 'utf8')) as {
    version: number
    scopes: Record<string, readonly string[]>
  }
  expect(cache.version).toBe(2)
  expect(cache.scopes).toEqual({ 'application:application:guild:guild': [] })
})

test('requires registration credentials', () => {
  expect(() => parseRegistrationCliOptions([], {})).toThrow('DISCORD_APPLICATION_ID')
  expect(() => parseRegistrationCliOptions([], { DISCORD_APPLICATION_ID: 'application' })).toThrow(
    'DISCORD_TOKEN'
  )
})

test('requires a guild when selecting modules for registration', () => {
  expect(() =>
    parseRegistrationCliOptions(['register', '--module', 'economy'], {
      DISCORD_APPLICATION_ID: 'application',
      DISCORD_TOKEN: 'token'
    })
  ).toThrow('--module option requires --guild')
  expect(parseRegistrationCliOptions(['modules', 'list'], {})).toEqual({
    command: 'modules-list'
  })
})

function commandPayload(name: string) {
  return {
    description: name,
    name,
    type: ApplicationCommandTypes.CHAT_INPUT
  } as const
}

function createRoutes(commands: readonly Record<string, unknown>[] = []) {
  return {
    createGlobalCommand: vi.fn(async () => undefined),
    createGuildCommand: vi.fn(async () => undefined),
    deleteGlobalCommand: vi.fn(async () => undefined),
    deleteGuildCommand: vi.fn(async () => undefined),
    editGlobalCommand: vi.fn(async () => undefined),
    editGuildCommand: vi.fn(async () => undefined),
    getGlobalCommands: vi.fn(async () => []),
    getGuildCommands: vi.fn(async () => [...commands])
  }
}
