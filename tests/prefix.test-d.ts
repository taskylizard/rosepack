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

type PrefixSchemaOfLength<
  TLength extends number,
  TCount extends unknown[] = [],
  TResult extends string = ''
> = TCount['length'] extends TLength
  ? TResult
  : PrefixSchemaOfLength<
      TLength,
      [...TCount, unknown],
      `${TResult}[value${TCount['length']}: string]`
    >

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
  expectTypeOf<ValidatePrefixOptionSchema<string, typeof parsers>>().toEqualTypeOf<
    RosepackTypeError<'Prefix option schemas must be string literals, not the widened string type.'>
  >()
  expectTypeOf<ValidatePrefixOptionSchema<'value: string', typeof parsers>>().toEqualTypeOf<
    RosepackTypeError<'Invalid prefix options schema near "value: string".'>
  >()
  expectTypeOf<ValidatePrefixOptionSchema<'[value]', typeof parsers>>().toEqualTypeOf<
    RosepackTypeError<'Invalid prefix option segment "value". Expected [name: Parser].'>
  >()
  expectTypeOf<ValidatePrefixOptionSchema<'[: string]', typeof parsers>>().toEqualTypeOf<
    RosepackTypeError<'Prefix option names cannot be empty.'>
  >()
  expectTypeOf<
    ValidatePrefixOptionSchema<PrefixSchemaOfLength<33>, typeof parsers>
  >().toEqualTypeOf<RosepackTypeError<'Prefix commands support at most 32 positional options.'>>()
  expectTypeOf<ValidatePrefixOptionSchema<'[user: Missing]', typeof parsers>>().toEqualTypeOf<
    RosepackTypeError<'Unknown prefix option parser "Missing".'>
  >()
  expectTypeOf<
    ValidatePrefixOptionSchema<'[user: User] [user: User]', typeof parsers>
  >().toEqualTypeOf<RosepackTypeError<'Duplicate prefix option "user".'>>()
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
    ValidatePrefixFlags<{ target: { parser: 'Missing' } }, typeof parsers>
  >().toEqualTypeOf<RosepackTypeError<'Prefix flag "target" uses unknown parser "Missing".'>>()
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

test('keeps invalid option diagnostics on options without cascading into valid fields', () => {
  prefix({
    flags: {
      uppercase: {
        aliases: ['u'],
        description: 'Uppercase the response',
        kind: 'boolean'
      }
    },
    name: 'echo',
    // @ts-expect-error required options cannot follow optional options
    options: '[user?: User] [text: rest]',
    async execute(context) {
      const text = context.flags.uppercase
        ? context.options.text.toLocaleUpperCase()
        : context.options.text
      expectTypeOf(text).toBeAny()
    }
  })
})

test('reports every schema validation class on the options property', () => {
  const widenedSchema: string = '[value: string]'
  prefix({
    name: 'widened',
    // @ts-expect-error schemas must remain string literals for static validation and inference
    options: widenedSchema,
    async execute() {}
  })
  prefix({
    name: 'syntax',
    // @ts-expect-error schemas consist of bracketed option segments
    options: 'value: string',
    async execute() {}
  })
  prefix({
    name: 'segment',
    // @ts-expect-error option segments require a parser
    options: '[value]',
    async execute() {}
  })
  prefix({
    name: 'empty-name',
    // @ts-expect-error option names cannot be empty
    options: '[: string]',
    async execute() {}
  })
  prefix({
    name: 'duplicate-option',
    // @ts-expect-error option names must be unique
    options: '[value: string] [value: string]',
    async execute() {}
  })
  prefix({
    name: 'rest-last',
    // @ts-expect-error rest-consuming options must be last
    options: '[values: rest] [count: integer]',
    async execute() {}
  })
  prefix({
    name: 'too-many-options',
    // @ts-expect-error prefix commands support at most 32 positional options
    options:
      '[v00: string][v01: string][v02: string][v03: string][v04: string][v05: string][v06: string][v07: string][v08: string][v09: string][v10: string][v11: string][v12: string][v13: string][v14: string][v15: string][v16: string][v17: string][v18: string][v19: string][v20: string][v21: string][v22: string][v23: string][v24: string][v25: string][v26: string][v27: string][v28: string][v29: string][v30: string][v31: string][v32: string]',
    async execute() {}
  })
})

test('reports every flag validation class on the flags property', () => {
  prefix({
    // @ts-expect-error value flags must use a known parser
    flags: { target: { parser: 'Missing' } },
    name: 'unknown-flag-parser',
    async execute() {}
  })
  prefix({
    // @ts-expect-error value flags cannot consume the rest of the input
    flags: { values: { parser: 'rest' } },
    name: 'rest-flag-parser',
    async execute() {}
  })
  prefix({
    // @ts-expect-error canonical flag names and aliases are case-insensitively unique
    flags: {
      first: { aliases: ['shared'], kind: 'boolean' },
      shared: { kind: 'boolean' }
    },
    name: 'duplicate-flag-token',
    async execute() {}
  })
})

test('rejects duplicate literal command names and aliases at registry call sites', () => {
  const first = prefix({ aliases: ['x'], name: 'first', async execute() {} })
  const second = prefix({ aliases: ['X'], name: 'second', async execute() {} })

  // @ts-expect-error literal command tuples cannot contain duplicate names or aliases
  prefixCommands.createRegistry([first, second], { prefixes: '!' })
})
