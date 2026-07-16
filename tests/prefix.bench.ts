import type { Message } from 'oceanic.js'
import { bench, describe, vi } from 'vite-plus/test'
import { createRosepack, tokenizePrefixInput } from '../src/index.ts'
import { createDefaultPrefixParsers } from '../src/prefix-parsers.ts'
import { compilePrefixOptionSchema } from '../src/prefix-schema.ts'

const simpleInput = 'ban 123 repeated bad behavior --force --days=7'
const quotedInput = Array.from(
  { length: 80 },
  (_, index) => `"quoted value ${index}" escaped\\ value${index}`
).join(' ')
const maximumSchema =
  Array.from({ length: 31 }, (_, index) => `[value${index}: string]`).join(' ') + ' [tail?: rest]'
const parsers = createDefaultPrefixParsers<{}>()

describe('prefix parser primitives', () => {
  bench('tokenize a normal command', () => {
    tokenizePrefixInput(simpleInput)
  })

  bench('tokenize a long quoted command', () => {
    tokenizePrefixInput(quotedInput)
  })

  bench('compile a normal option schema', () => {
    compilePrefixOptionSchema('[target: integer] [reason?: rest]', parsers)
  })

  bench('compile the maximum option schema', () => {
    compilePrefixOptionSchema(maximumSchema, parsers)
  })
})

describe('prefix registry dispatch', () => {
  const rosepack = createRosepack<{}>()
  const prefixCommands = rosepack.createPrefixCommands()
  const { prefix } = prefixCommands
  const simpleRegistry = prefixCommands.createRegistry(
    [prefix({ name: 'ping', async execute() {} })],
    { prefixes: '!' }
  )
  const complexRegistry = prefixCommands.createRegistry(
    [
      prefix({
        aliases: ['m'],
        name: 'moderation',
        subcommands: [
          prefix({
            aliases: ['u'],
            name: 'users',
            subcommands: [
              prefix({
                aliases: ['b'],
                flags: {
                  days: { aliases: ['d'], parser: 'integer', required: true },
                  force: { aliases: ['f'], kind: 'boolean' },
                  tag: { aliases: ['t'], multiple: true, parser: 'string' }
                },
                name: 'ban',
                options: '[target: integer] [reason?: rest]',
                async execute() {}
              })
            ]
          })
        ]
      })
    ],
    { prefixes: ['!', '!!'] }
  )
  const simpleMessage = createMessage('!ping')
  const complexMessage = createMessage(
    '!!m u b 123 "repeated bad behavior" --force --days=7 --tag one --tag two'
  )

  bench('dispatch a simple command', async () => {
    await simpleRegistry.dispatch({ app: {}, message: simpleMessage })
  })

  bench('dispatch a routed command with options and flags', async () => {
    await complexRegistry.dispatch({ app: {}, message: complexMessage })
  })
})

function createMessage(content: string): Message {
  // tasky: Benchmarks reuse an inert Oceanic-shaped message so they measure rosepack, not mocks.
  return {
    author: { bot: false },
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
