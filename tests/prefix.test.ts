import type { Message, User } from 'oceanic.js'
import { expect, test, vi } from 'vite-plus/test'
import {
  createRosepack,
  PrefixCommandValidationError,
  tokenizePrefixInput,
  type PrefixCommandDefinitionBase
} from '../src/index.ts'

interface TestApp {
  events: string[]
}

const rosepack = createRosepack<TestApp>()
const Upper = rosepack.prefixParser({
  consumption: 'token',
  parse({ value }) {
    return value.toLocaleUpperCase()
  }
})
const prefixCommands = rosepack.createPrefixCommands({ parsers: { Upper } })
const { prefix } = prefixCommands

test('tokenizes quotes and escapes while preserving source ranges', () => {
  expect(tokenizePrefixInput(`one "two three" four\\ five 'six'`)).toEqual([
    { end: 3, raw: 'one', start: 0, value: 'one' },
    { end: 15, raw: '"two three"', start: 4, value: 'two three' },
    { end: 26, raw: 'four\\ five', start: 16, value: 'four five' },
    { end: 32, raw: "'six'", start: 27, value: 'six' }
  ])
})

test('routes aliases through arbitrary depth and parses typed options and flags', async () => {
  const execute = vi.fn(async (_context: unknown) => undefined)
  const beforeRoot = vi.fn(async (_context: unknown) => undefined)
  const beforeLeaf = vi.fn(async (_context: unknown) => undefined)
  const command = prefix({
    aliases: ['a'],
    async beforeExecute({ app }) {
      app.events.push('root')
      await beforeRoot(app)
    },
    name: 'admin',
    subcommands: [
      prefix({
        aliases: ['u'],
        name: 'users',
        subcommands: [
          prefix({
            aliases: ['b'],
            async beforeExecute({ app }) {
              app.events.push('leaf')
              await beforeLeaf(app)
            },
            flags: {
              count: { aliases: ['c'], parser: 'integer', required: true },
              force: { aliases: ['f'], kind: 'boolean' },
              tag: { aliases: ['t'], multiple: true, parser: 'Upper' }
            },
            name: 'ban',
            options: '[target: integer] [reason?: rest]',
            async execute(context) {
              await execute(context)
            }
          })
        ]
      })
    ]
  })
  const registry = prefixCommands.createRegistry([command], { prefixes: ['!', '!!'] })
  const app: TestApp = { events: [] }
  const message = createMessage('!!a u b 42 "being rude" --force -c=2 -t one --tag two')

  expect(await registry.dispatch({ app, message })).toBe(true)

  const context = execute.mock.calls[0]?.[0]
  expect(context).toMatchObject({
    app,
    command: { name: 'admin', path: ['admin'] },
    flags: { count: 2, force: true, tag: ['ONE', 'TWO'] },
    message,
    node: { name: 'ban', path: ['admin', 'users', 'ban'] },
    options: { reason: 'being rude', target: 42 },
    path: ['admin', 'users', 'ban'],
    prefix: '!!',
    rawArguments: '42 "being rude" --force -c=2 -t one --tag two',
    registry
  })
  expect(app.events).toEqual(['root', 'leaf'])
  expect(beforeRoot).toHaveBeenCalledOnce()
  expect(beforeLeaf).toHaveBeenCalledOnce()
  expect(registry.resolve('a u b')?.definition).toBe(command.subcommands![0]!.subcommands![0])
  expect(Object.isFrozen(registry.tree)).toBe(true)
  expect(Object.isFrozen(command)).toBe(true)
})

test('supports boolean negation, the flag terminator, and optional values', async () => {
  const execute = vi.fn(async (_context: unknown) => undefined)
  const command = prefix({
    flags: { force: { kind: 'boolean' } },
    name: 'echo',
    options: '[text?: rest]',
    async execute(context) {
      await execute(context)
    }
  })
  const registry = prefixCommands.createRegistry([command], { prefixes: '!' })

  await registry.dispatch({
    app: { events: [] },
    message: createMessage('!echo --no-force -- --force hi')
  })

  expect(execute.mock.calls[0]?.[0]).toMatchObject({
    flags: { force: false },
    options: { text: '--force hi' }
  })
})

test('keeps negative integers positional instead of mistaking them for short flags', async () => {
  const execute = vi.fn(async (_context: unknown) => undefined)
  const command = prefix({
    name: 'number',
    options: '[value: integer]',
    async execute(context) {
      await execute(context)
    }
  })
  const registry = prefixCommands.createRegistry([command], { prefixes: '!' })

  await registry.dispatch({ app: { events: [] }, message: createMessage('!number -5') })

  expect(execute.mock.calls[0]?.[0]).toMatchObject({ options: { value: -5 } })
})

test('resolves built-in users and sends safe replies through Oceanic REST', async () => {
  const user = { id: '123' } as User
  const command = prefix({
    name: 'who',
    options: '[user: User]',
    async execute(context) {
      await context.reply(context.options.user.id)
    }
  })
  const registry = prefixCommands.createRegistry([command], { prefixes: '!' })
  const message = createMessage('!who <@123>')
  const createResponse = vi.spyOn(message.client.rest.channels, 'createMessage')
  message.mentions.users.push(user)

  await registry.dispatch({ app: { events: [] }, message })

  expect(createResponse).toHaveBeenCalledWith('channel', {
    allowedMentions: { everyone: false, repliedUser: false, roles: false, users: false },
    content: '123'
  })
})

test('sends parser and routing failures through the nearest parse hook', async () => {
  const onParseError = vi.fn(async (_context: unknown) => undefined)
  const command = prefix({
    name: 'math',
    onParseError,
    subcommands: [prefix({ name: 'add', options: '[value: integer]', async execute() {} })]
  })
  const registry = prefixCommands.createRegistry([command], { prefixes: '!' })
  const app: TestApp = { events: [] }

  await registry.dispatch({ app, message: createMessage('!math nope') })
  await registry.dispatch({ app, message: createMessage('!math add wat') })

  expect(onParseError).toHaveBeenCalledTimes(2)
  expect(onParseError.mock.calls[0]?.[0]).toMatchObject({
    app,
    error: { code: 'unknown-subcommand', input: 'nope' },
    path: ['math']
  })
  expect(onParseError.mock.calls[1]?.[0]).toMatchObject({
    error: { code: 'parser-failed', option: 'value' },
    path: ['math', 'add']
  })
})

test('throws unhandled parse errors with stable structured fields', async () => {
  const command = prefix({ name: 'required', options: '[value: string]', async execute() {} })
  const registry = prefixCommands.createRegistry([command], { prefixes: '!' })

  await expect(
    registry.dispatch({ app: { events: [] }, message: createMessage('!required') })
  ).rejects.toMatchObject({
    code: 'missing-option',
    option: 'value',
    path: ['required']
  })
})

test('routes execution errors to the nearest error hook', async () => {
  const failure = new Error('nope')
  const rootError = vi.fn(async (_context: unknown, _error: unknown) => undefined)
  const leafError = vi.fn(async (_context: unknown, _error: unknown) => undefined)
  const command = prefix({
    name: 'root',
    onError: rootError,
    subcommands: [
      prefix({
        name: 'leaf',
        onError: leafError,
        async execute() {
          throw failure
        }
      })
    ]
  })
  const registry = prefixCommands.createRegistry([command], { prefixes: '!' })

  await registry.dispatch({ app: { events: [] }, message: createMessage('!root leaf') })

  expect(leafError).toHaveBeenCalledOnce()
  expect(leafError.mock.calls[0]?.[1]).toBe(failure)
  expect(rootError).not.toHaveBeenCalled()
})

test('invokes typed commands and rejects direct recursion', async () => {
  const targetExecute = vi.fn(async (_context: unknown) => undefined)
  const target = prefix({
    flags: { force: { kind: 'boolean' } },
    name: 'target',
    options: '[value: integer]',
    async execute(context) {
      await targetExecute(context)
    }
  })
  const source = prefix({
    name: 'source',
    async execute(context) {
      await context.invoke(target, { flags: { force: true }, options: { value: 7 } })
    }
  })
  const recursive = prefix({
    name: 'recursive',
    async execute(context) {
      await context.invoke(recursive, { flags: {}, options: {} })
    }
  })
  const registry = prefixCommands.createRegistry([source, target, recursive], { prefixes: '!' })

  await registry.dispatch({ app: { events: [] }, message: createMessage('!source') })
  expect(targetExecute.mock.calls[0]?.[0]).toMatchObject({
    flags: { force: true },
    options: { value: 7 },
    path: ['target']
  })
  await expect(
    registry.dispatch({ app: { events: [] }, message: createMessage('!recursive') })
  ).rejects.toThrow('Recursive prefix command invocation')
})

test('validates duplicate aliases, schemas, flags, and reused definitions', () => {
  const reused = prefix({ name: 'same', async execute() {} })
  const unsafePrefix = prefix as unknown as (
    definition: object
  ) => PrefixCommandDefinitionBase<TestApp>
  const invalid: readonly PrefixCommandDefinitionBase<TestApp>[] = [
    prefix({ aliases: ['x'], name: 'one', async execute() {} }),
    prefix({ aliases: ['X'], name: 'two', async execute() {} }),
    unsafePrefix({
      flags: {
        bad: { aliases: ['b'], parser: 'integer' },
        worse: { aliases: ['B'], kind: 'boolean' }
      },
      name: 'flags',
      async execute() {}
    }),
    unsafePrefix({ name: 'schema', options: '[value: Missing]', async execute() {} }),
    prefix({ name: 'parent-one', subcommands: [reused] }),
    prefix({ name: 'parent-two', subcommands: [reused] })
  ]

  expect(() => prefixCommands.createRegistry(invalid, { prefixes: '!' })).toThrow(
    PrefixCommandValidationError
  )
  expect(prefixCommands.lint(invalid).map((issue) => issue.code)).toEqual(
    expect.arrayContaining([
      'duplicate-command-name',
      'duplicate-flag-name',
      'invalid-options-schema',
      'reused-definition'
    ])
  )
})

test('supports dynamic prefixes, unknown-command hooks, and ignored bot messages', async () => {
  const onUnknownCommand = vi.fn(async (_context: unknown) => undefined)
  const execute = vi.fn(async () => undefined)
  const registry = prefixCommands.createRegistry([prefix({ name: 'known', execute })], {
    onUnknownCommand,
    prefixes: ({ app }) => (app.events.length === 0 ? ['?', '??'] : '!')
  })
  const app: TestApp = { events: [] }

  expect(await registry.dispatch({ app, message: createMessage('??known') })).toBe(true)
  expect(await registry.dispatch({ app, message: createMessage('?missing') })).toBe(false)
  expect(await registry.dispatch({ app, message: createMessage('?known', { bot: true }) })).toBe(
    false
  )
  expect(execute).toHaveBeenCalledOnce()
  expect(onUnknownCommand).toHaveBeenCalledOnce()
})

function createMessage(content: string, author: { bot: boolean } = { bot: false }): Message {
  return {
    author,
    channelID: 'channel',
    client: {
      getChannel: vi.fn(),
      guilds: new Map(),
      rest: {
        channels: { createMessage: vi.fn(async () => ({})) },
        users: { get: vi.fn() }
      },
      users: new Map()
    },
    content,
    guildID: null,
    mentions: { channels: [], everyone: false, members: [], roles: [], users: [] },
    webhookID: undefined
  } as unknown as Message
}
