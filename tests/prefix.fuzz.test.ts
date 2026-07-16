import type { Message } from 'oceanic.js'
import { expect, test, vi } from 'vite-plus/test'
import { createRosepack, PrefixCommandParseError, tokenizePrefixInput } from '../src/index.ts'
import {
  createDefaultPrefixParsers,
  createPrefixParserFail,
  type PrefixParserRecord
} from '../src/prefix-parsers.ts'
import { compilePrefixOptionSchema } from '../src/prefix-schema.ts'

const fuzzAlphabet = [
  '\0',
  '\t',
  '\n',
  ' ',
  '"',
  "'",
  '\\',
  '-',
  '=',
  '[',
  ']',
  ':',
  '?',
  '_',
  'a',
  'Z',
  '0',
  'é',
  '\u00a0',
  '\ud800'
] as const

test('fuzzes tokenization with arbitrary UTF-16, quotes, escapes, and whitespace', () => {
  const random = createRandom(0x5eed_c0de)

  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    const input = randomString(random, randomInteger(random, 256))
    try {
      const tokens = tokenizePrefixInput(input)
      let previousEnd = 0
      for (const token of tokens) {
        expect(token.start).toBeGreaterThanOrEqual(previousEnd)
        expect(token.end).toBeGreaterThanOrEqual(token.start)
        expect(token.end).toBeLessThanOrEqual(input.length)
        expect(token.raw).toBe(input.slice(token.start, token.end))
        previousEnd = token.end
      }
    } catch (error) {
      expect(error).toBeInstanceOf(PrefixCommandParseError)
      expect((error as PrefixCommandParseError).code).toBe('unterminated-quote')
    }
  }
})

test('bounds oversized command lines and token floods', () => {
  expect(() => tokenizePrefixInput('x'.repeat(16_385))).toThrow(
    expect.objectContaining({ code: 'input-too-long' })
  )
  expect(() => tokenizePrefixInput(Array.from({ length: 257 }, () => 'x').join(' '))).toThrow(
    expect.objectContaining({ code: 'too-many-tokens' })
  )
})

test('fuzzes schema compilation and rejects inherited parser names', () => {
  const parsers = createDefaultPrefixParsers<{}>()
  const random = createRandom(0xc0ff_ee11)

  expect(() => compilePrefixOptionSchema('[value: toString]', parsers)).toThrow(
    'Unknown prefix option parser "toString".'
  )
  expect(() => compilePrefixOptionSchema('[value: constructor]', parsers)).toThrow(
    'Unknown prefix option parser "constructor".'
  )

  for (let iteration = 0; iteration < 5_000; iteration += 1) {
    const schema = randomString(random, randomInteger(random, 192))
    try {
      const options = compilePrefixOptionSchema(schema, parsers)
      const names = new Set<string>()
      let optionalSeen = false
      for (const [index, option] of options.entries()) {
        expect(names.has(option.name)).toBe(false)
        expect(Object.hasOwn(parsers, option.parser)).toBe(true)
        expect(optionalSeen && !option.optional).toBe(false)
        if ((parsers as PrefixParserRecord<{}>)[option.parser]!.consumption === 'rest') {
          expect(index).toBe(options.length - 1)
        }
        names.add(option.name)
        optionalSeen ||= option.optional
      }
      expect(options.length).toBeLessThanOrEqual(32)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
    }
  }
})

test('fuzzes every built-in parser with arbitrary token values', async () => {
  const parsers = createDefaultPrefixParsers<{}>()
  const random = createRandom(0xface_feed)
  const message = createMessage('')

  for (let iteration = 0; iteration < 2_000; iteration += 1) {
    const value = randomString(random, randomInteger(random, 96))
    for (const [name, parser] of Object.entries(parsers)) {
      try {
        const result = await parser.parse({
          app: {},
          commandPath: ['fuzz'],
          fail: createPrefixParserFail(),
          message,
          optionName: name,
          raw: value,
          value,
          values: [value]
        })
        if (name === 'boolean') {
          expect(typeof result).toBe('boolean')
        } else if (name === 'integer' || name === 'number') {
          expect(typeof result).toBe('number')
          expect(Number.isFinite(result)).toBe(true)
        } else if (name === 'string' || name === 'rest') {
          expect(result).toBe(value)
        } else {
          expect(result).toBeTypeOf('object')
        }
      } catch (error) {
        expect(error).toMatchObject({ name: 'PrefixParserFailure' })
      }
    }
  }
})

test('fuzzes complete dispatch without leaking unexpected exceptions', async () => {
  const rosepack = createRosepack<{}>()
  const prefixCommands = rosepack.createPrefixCommands()
  const { prefix } = prefixCommands
  const registry = prefixCommands.createRegistry(
    [
      prefix({
        aliases: ['c'],
        flags: {
          count: { aliases: ['n'], parser: 'integer' },
          force: { aliases: ['f'], kind: 'boolean' },
          tag: { aliases: ['t'], multiple: true, parser: 'string' }
        },
        name: 'command',
        options: '[target?: integer] [tail?: rest]',
        async execute() {}
      })
    ],
    {
      async onParseError() {},
      prefixes: ['!', '!!']
    }
  )
  const random = createRandom(0xabad_1dea)

  for (let iteration = 0; iteration < 5_000; iteration += 1) {
    const input = randomString(random, randomInteger(random, 256))
    await expect(
      registry.dispatch({ app: {}, message: createMessage(`!${input}`) })
    ).resolves.toBeTypeOf('boolean')
  }
})

test('keeps adversarial option names in null-prototype result bags', async () => {
  const rosepack = createRosepack<{}>()
  const ObjectValue = rosepack.prefixParser({
    consumption: 'token',
    parse() {
      return { polluted: true }
    }
  })
  const prefixCommands = rosepack.createPrefixCommands({ parsers: { ObjectValue } })
  const { prefix } = prefixCommands
  let received: object | undefined
  const registry = prefixCommands.createRegistry(
    [
      prefix({
        name: 'safe',
        options: '[__proto__: ObjectValue] [constructor?: string]',
        async execute(context) {
          received = context.options
        }
      })
    ],
    { prefixes: '!' }
  )

  await registry.dispatch({ app: {}, message: createMessage('!safe payload constructor-value') })

  expect(Object.getPrototypeOf(received!)).toBeNull()
  expect(Object.hasOwn(received!, '__proto__')).toBe(true)
  expect((received as { __proto__: { polluted: boolean } }).__proto__.polluted).toBe(true)
  expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false)
})

function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    // tasky: Mulberry32 is deterministic, quick, and gives every fuzz failure a reproducible seed.
    state += 0x6d2b_79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function randomInteger(random: () => number, maximum: number): number {
  return Math.floor(random() * (maximum + 1))
}

function randomString(random: () => number, length: number): string {
  let result = ''
  for (let index = 0; index < length; index += 1) {
    result += fuzzAlphabet[Math.floor(random() * fuzzAlphabet.length)]
  }
  return result
}

function createMessage(content: string): Message {
  return {
    author: { bot: false },
    channelID: 'channel',
    client: {
      getChannel: vi.fn(),
      guilds: new Map(),
      rest: {
        channels: { createMessage: vi.fn(async () => ({})) },
        users: {
          get: vi.fn(async () => {
            throw new Error('not found')
          })
        }
      },
      users: new Map()
    },
    content,
    guildID: null,
    mentions: { channels: [], everyone: false, members: [], roles: [], users: [] },
    webhookID: undefined
  } as unknown as Message
}
