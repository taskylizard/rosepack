import type { Message, User } from 'oceanic.js'
import { expectTypeOf, test } from 'vite-plus/test'
import {
  createRosepack,
  type PrefixCommandContext,
  type PrefixCommandParseError,
  type RosepackTypeError,
  type ValidatePrefixFlags,
  type ValidatePrefixOptionSchema
} from '../src/index.ts'

interface TestApp {
  service: 'test'
}

const rosepack = createRosepack<TestApp>()
const Snowflake = rosepack.prefixParser({
  consumption: 'token',
  parse({ app, fail, value }) {
    expectTypeOf(app).toEqualTypeOf<TestApp>()
    return /^\d+$/u.test(value) ? { id: value } : fail('Expected a snowflake.')
  }
})
const { parsers, prefix } = rosepack.createPrefixCommands({ parsers: { Snowflake } })

const command = prefix({
  aliases: ['b'],
  description: 'Ban a user',
  flags: {
    count: { aliases: ['c'], parser: 'integer', required: true },
    force: { aliases: ['f'], kind: 'boolean' },
    tag: { aliases: ['t'], multiple: true, parser: 'string' }
  },
  name: 'ban',
  options: '[target: Snowflake] [user: User] [reason?: rest]',
  async execute(context) {
    expectTypeOf(context.app).toEqualTypeOf<TestApp>()
    expectTypeOf(context.message).toEqualTypeOf<Message>()
    expectTypeOf(context.options).toEqualTypeOf<{
      target: { id: string }
      user: User
      reason?: string
    }>()
    expectTypeOf(context.flags).toEqualTypeOf<{
      count: number
      force: boolean
      tag: readonly string[]
    }>()
  }
})

test('preserves inferred values on returned definitions and invocation', () => {
  type Context = Parameters<NonNullable<typeof command.execute>>[0]
  expectTypeOf<Context>().toExtend<PrefixCommandContext<TestApp>>()
  expectTypeOf<Context['options']['target']>().toEqualTypeOf<{ id: string }>()
  expectTypeOf<Context['flags']['force']>().toEqualTypeOf<boolean>()
})

test('reports exact schema and flag validation types', () => {
  expectTypeOf<ValidatePrefixOptionSchema<'[user: Missing]', typeof parsers>>().toEqualTypeOf<
    RosepackTypeError<'Unknown prefix option parser "Missing".'>
  >()
  expectTypeOf<
    ValidatePrefixOptionSchema<'[reason: rest] [user: User]', typeof parsers>
  >().toEqualTypeOf<RosepackTypeError<'Rest-consuming prefix option "reason" must be last.'>>()
  expectTypeOf<
    ValidatePrefixOptionSchema<'[reason?: string] [user: User]', typeof parsers>
  >().toEqualTypeOf<
    RosepackTypeError<'Required prefix option "user" cannot follow an optional option.'>
  >()
  expectTypeOf<ValidatePrefixFlags<{ greedy: { parser: 'rest' } }, typeof parsers>>().toEqualTypeOf<
    RosepackTypeError<'Prefix flag "greedy" cannot use a rest-consuming parser.'>
  >()
  expectTypeOf<
    ValidatePrefixFlags<
      {
        first: { aliases: ['f']; kind: 'boolean' }
        force: { aliases: ['F']; kind: 'boolean' }
      },
      typeof parsers
    >
  >().toEqualTypeOf<RosepackTypeError<'Duplicate prefix flag name or alias "f".'>>()
})

test('contextually types deep prefix nodes and parse hooks', () => {
  prefix({
    name: 'root',
    onParseError({ app, error, message }) {
      expectTypeOf(app).toEqualTypeOf<TestApp>()
      expectTypeOf(error).toEqualTypeOf<PrefixCommandParseError>()
      expectTypeOf(message).toEqualTypeOf<Message>()
    },
    subcommands: [
      prefix({
        name: 'level-one',
        subcommands: [
          prefix({
            name: 'level-two',
            options: '[value: integer]',
            async execute({ options }) {
              expectTypeOf(options).toEqualTypeOf<{ value: number }>()
            }
          })
        ]
      })
    ]
  })
})

test('rejects invalid schemas at definition sites', () => {
  prefix({
    name: 'unknown',
    // @ts-expect-error unknown parsers are reported on the options property
    options: '[value: Missing]',
    async execute() {}
  })

  prefix({
    // @ts-expect-error rest parsers are reported on the flags property
    flags: { greedy: { parser: 'rest' } },
    name: 'rest-flag',
    async execute() {}
  })

  prefix({
    // @ts-expect-error sibling flag aliases cannot collide
    flags: {
      first: { aliases: ['f'], kind: 'boolean' },
      force: { aliases: ['F'], kind: 'boolean' }
    },
    name: 'duplicate-flags',
    async execute() {}
  })

  // @ts-expect-error routing-only commands need at least one child
  prefix({ name: 'empty', subcommands: [] })
})

test('rejects duplicate literal command names and aliases at registry call sites', () => {
  const first = prefix({ aliases: ['x'], name: 'first', async execute() {} })
  const second = prefix({ aliases: ['X'], name: 'second', async execute() {} })

  // @ts-expect-error literal command tuples cannot contain duplicate names or aliases
  prefixCommands.createRegistry([first, second], { prefixes: '!' })
})
