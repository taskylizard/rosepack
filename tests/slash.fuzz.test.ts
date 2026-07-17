import { ApplicationCommandOptionTypes, CommandInteraction } from 'oceanic.js'
import type { InteractionOptions } from 'oceanic.js'
import { expect, test } from 'vite-plus/test'
import {
  createRosepack,
  lintSlashCommandTree,
  type SlashCommandValueOptionRecord,
  type SlashRootCommandDefinitionBase
} from '../src/index.ts'

const rosepack = createRosepack<{}>()
const { slash } = rosepack

test('fuzzes raw interaction option arrays without leaking non-Error failures', async () => {
  const command = slash({
    description: 'Fuzz options',
    name: 'fuzz',
    options: {
      count: { description: 'Count', kind: 'integer' },
      enabled: { description: 'Enabled', kind: 'boolean' },
      label: { description: 'Label', kind: 'string', maxLength: 32 },
      ratio: { description: 'Ratio', kind: 'number' }
    },
    async execute() {}
  })
  const registry = rosepack.createRegistry([command])
  const random = createRandom(0x51a5_51a5)

  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    const raw = Array.from({ length: randomInteger(random, 40) }, () => randomRawOption(random))
    try {
      await registry.dispatch({ app: {}, interaction: createInteraction('fuzz', raw) })
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
    }
  }
})

test('rejects duplicate, oversized, non-finite, fractional, and invalid-length options', async () => {
  const command = slash({
    description: 'Strict values',
    name: 'strict',
    options: {
      choice: {
        choices: [{ name: 'Allowed', value: 'allowed' }],
        description: 'Choice',
        kind: 'string'
      },
      count: { description: 'Count', kind: 'integer' },
      label: { description: 'Label', kind: 'string', maxLength: 4, minLength: 2 },
      ratio: { description: 'Ratio', kind: 'number' }
    },
    async execute() {}
  })
  const registry = rosepack.createRegistry([command])
  const cases: InteractionOptions[][] = [
    [
      { name: 'count', type: ApplicationCommandOptionTypes.INTEGER, value: 1 },
      { name: 'count', type: ApplicationCommandOptionTypes.INTEGER, value: 2 }
    ],
    Array.from({ length: 26 }, (_, index) => ({
      name: `unknown-${index}`,
      type: ApplicationCommandOptionTypes.STRING,
      value: 'x'
    })),
    [{ name: 'count', type: ApplicationCommandOptionTypes.INTEGER, value: 1.5 }],
    [{ name: 'ratio', type: ApplicationCommandOptionTypes.NUMBER, value: Number.NaN }],
    [
      { name: 'ratio', type: ApplicationCommandOptionTypes.NUMBER, value: Number.POSITIVE_INFINITY }
    ],
    [{ name: 'label', type: ApplicationCommandOptionTypes.STRING, value: 'x' }],
    [{ name: 'label', type: ApplicationCommandOptionTypes.STRING, value: 'xxxxx' }],
    [{ name: 'choice', type: ApplicationCommandOptionTypes.STRING, value: 'denied' }]
  ]

  for (const raw of cases) {
    await expect(
      registry.dispatch({ app: {}, interaction: createInteraction('strict', raw) })
    ).rejects.toBeInstanceOf(Error)
  }
})

test('keeps adversarial slash option names in null-prototype result bags', async () => {
  const definitions = Object.create(null) as SlashCommandValueOptionRecord
  Object.defineProperties(definitions, {
    ['__proto__']: {
      enumerable: true,
      value: { description: 'Prototype-shaped option', kind: 'string', required: true }
    },
    constructor: {
      enumerable: true,
      value: { description: 'Constructor-shaped option', kind: 'string', required: true }
    }
  })
  let received: object | undefined
  const command = slash({
    description: 'Safe records',
    name: 'safe-records',
    options: definitions,
    async execute(context) {
      received = context.options
    }
  })
  const registry = rosepack.createRegistry([command])

  await registry.dispatch({
    app: {},
    interaction: createInteraction('safe-records', [
      { name: '__proto__', type: ApplicationCommandOptionTypes.STRING, value: 'safe' },
      { name: 'constructor', type: ApplicationCommandOptionTypes.STRING, value: 'also-safe' }
    ])
  })

  expect(Object.getPrototypeOf(received!)).toBeNull()
  expect(Object.hasOwn(received!, '__proto__')).toBe(true)
  expect(Object.hasOwn(received!, 'constructor')).toBe(true)
  expect(Object.hasOwn(Object.prototype, 'safe')).toBe(false)
})

test('fuzzes string path normalization with arbitrary UTF-16 input', () => {
  const command = slash({ description: 'Known', name: 'known', async execute() {} })
  const registry = rosepack.createRegistry([command])
  const random = createRandom(0xdec0_de01)

  for (let iteration = 0; iteration < 20_000; iteration += 1) {
    const path = randomString(random, randomInteger(random, 128))
    expect(() => registry.resolve(path)).not.toThrow()
  }
  expect(registry.resolve('  /known  ')?.definition).toBe(command)
})

test('fuzzes runtime slash tree validation with arbitrary command records', () => {
  const random = createRandom(0x0dd5_eed5)

  for (let iteration = 0; iteration < 5_000; iteration += 1) {
    const commands = Array.from({ length: randomInteger(random, 8) }, (_, index) => ({
      description: randomString(random, randomInteger(random, 120)),
      name: randomString(random, randomInteger(random, 40)) || `fallback-${index}`
    })) as SlashRootCommandDefinitionBase[]
    expect(() => lintSlashCommandTree(commands)).not.toThrow()
  }
})

function randomRawOption(random: () => number): InteractionOptions {
  const names = ['count', 'enabled', 'label', 'ratio', '__proto__', 'constructor', 'unknown']
  const types = [
    ApplicationCommandOptionTypes.BOOLEAN,
    ApplicationCommandOptionTypes.INTEGER,
    ApplicationCommandOptionTypes.NUMBER,
    ApplicationCommandOptionTypes.STRING,
    ApplicationCommandOptionTypes.USER,
    999
  ]
  const values: unknown[] = [
    true,
    false,
    randomInteger(random, 100),
    random() * 100,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    randomString(random, randomInteger(random, 64)),
    null,
    {},
    undefined
  ]
  return {
    name: names[randomInteger(random, names.length - 1)]!,
    type: types[randomInteger(random, types.length - 1)]!,
    value: values[randomInteger(random, values.length - 1)]
  } as InteractionOptions
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    // tasky: Mulberry32 keeps the slash fuzz corpus deterministic and reproducible.
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
  const alphabet = ['\0', '\t', '\n', ' ', '-', '_', 'a', 'Z', '0', 'é', '\u00a0', '\ud800']
  let result = ''
  for (let index = 0; index < length; index += 1) {
    result += alphabet[randomInteger(random, alphabet.length - 1)]
  }
  return result
}

function createInteraction(name: string, raw: InteractionOptions[]): CommandInteraction {
  return Object.assign(Object.create(CommandInteraction.prototype), {
    acknowledged: false,
    data: { name, options: { raw } },
    isChatInputCommand: () => true
  }) as CommandInteraction
}
