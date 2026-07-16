import type { AnyChannel, Member, Message, Role, User } from 'oceanic.js'
import { PrefixParserFailure } from './prefix-errors.ts'

/** Whether a parser consumes one token or every remaining positional token. */
export type PrefixParserConsumption = 'rest' | 'token'

/** Runtime information available to a typed prefix option parser. */
export interface PrefixParserContext<TApp> {
  readonly app: TApp
  readonly commandPath: readonly string[]
  readonly message: Message
  readonly optionName: string
  readonly raw: string
  readonly value: string
  readonly values: readonly string[]
  readonly fail: (message: string) => never
}

/** User-authored parser definition accepted by `rosepack.prefixParser()`. */
export interface PrefixParserDefinition<
  TApp,
  TOutput,
  TConsumption extends PrefixParserConsumption
> {
  readonly consumption: TConsumption
  parse(context: PrefixParserContext<TApp>): TOutput | Promise<TOutput>
}

const prefixParserBrand = Symbol('rosepack.prefix-parser')

/** A runtime parser whose output type is discoverable by the option-schema type parser. */
export interface PrefixOptionParser<
  TApp,
  TOutput,
  TConsumption extends PrefixParserConsumption = PrefixParserConsumption
> extends PrefixParserDefinition<TApp, TOutput, TConsumption> {
  readonly [prefixParserBrand]: true
}

/** A parser-name-to-runtime-parser dictionary. */
export interface PrefixParserRecord<TApp> {
  [name: string]: PrefixOptionParser<TApp, unknown, PrefixParserConsumption>
}

/** Extracts the runtime value produced by a prefix option parser. */
export type PrefixParserOutput<TParser> =
  TParser extends PrefixOptionParser<infer _TApp, infer TOutput, infer _TConsumption>
    ? TOutput
    : never

/** Extracts whether a prefix option parser consumes one token or the remaining input. */
export type PrefixParserConsumptionOf<TParser> =
  TParser extends PrefixOptionParser<infer _TApp, infer _TOutput, infer TConsumption>
    ? TConsumption
    : never

/** A parser-definition helper already bound to rosepack's application context type. */
export interface DefinePrefixParser<TApp> {
  <const TConsumption extends PrefixParserConsumption, TOutput>(
    definition: PrefixParserDefinition<TApp, TOutput, TConsumption>
  ): PrefixOptionParser<TApp, Awaited<TOutput>, TConsumption>
}

/** Creates a branded prefix parser while preserving its exact output and consumption types. */
export function createPrefixParser<
  TApp,
  const TConsumption extends PrefixParserConsumption,
  TOutput
>(
  definition: PrefixParserDefinition<TApp, TOutput, TConsumption>
): PrefixOptionParser<TApp, Awaited<TOutput>, TConsumption> {
  return {
    ...definition,
    [prefixParserBrand]: true
  } as PrefixOptionParser<TApp, Awaited<TOutput>, TConsumption>
}

/** Built-in parser dictionary available to every prefix-command scope. */
export type DefaultPrefixParsers<TApp> = ReturnType<typeof createDefaultPrefixParsers<TApp>>

/** Creates the built-in primitive and Oceanic-aware prefix parsers. */
export function createDefaultPrefixParsers<TApp>() {
  return {
    boolean: createPrefixParser<TApp, 'token', boolean>({
      consumption: 'token',
      parse({ fail, value }) {
        const normalized = value.toLowerCase()
        if (['1', 'on', 'true', 'yes'].includes(normalized)) {
          return true
        }
        if (['0', 'false', 'no', 'off'].includes(normalized)) {
          return false
        }
        return fail(`Expected a boolean, received "${value}".`)
      }
    }),
    Channel: createPrefixParser<TApp, 'token', AnyChannel>({
      consumption: 'token',
      parse({ fail, message, value }) {
        const id = mentionID(value, /^<#(\d+)>$/u)
        const channel = id === undefined ? undefined : message.client.getChannel(id)
        return channel ?? fail(`Could not resolve channel "${value}".`)
      }
    }),
    integer: createPrefixParser<TApp, 'token', number>({
      consumption: 'token',
      parse({ fail, value }) {
        if (!/^[+-]?\d+$/u.test(value)) {
          return fail(`Expected an integer, received "${value}".`)
        }
        const result = Number(value)
        return Number.isSafeInteger(result)
          ? result
          : fail(`Integer "${value}" is outside JavaScript's safe range.`)
      }
    }),
    Member: createPrefixParser<TApp, 'token', Member>({
      consumption: 'token',
      async parse({ fail, message, value }) {
        const id = mentionID(value, /^<@!?(\d+)>$/u)
        const guild = cachedMessageGuild(message)
        if (id === undefined || guild === undefined) {
          return fail(`Could not resolve guild member "${value}".`)
        }
        const mentioned = message.mentions.members.find((member) => member.id === id)
        if (mentioned !== undefined) {
          return mentioned
        }
        const cached = guild.members.get(id)
        if (cached !== undefined) {
          return cached
        }
        try {
          return await guild.getMember(id)
        } catch {
          return fail(`Could not resolve guild member "${value}".`)
        }
      }
    }),
    Mentionable: createPrefixParser<TApp, 'token', Role | User>({
      consumption: 'token',
      async parse(context) {
        if (/^<@&\d+>$/u.test(context.value)) {
          return parseRole(context)
        }
        return parseUser(context)
      }
    }),
    number: createPrefixParser<TApp, 'token', number>({
      consumption: 'token',
      parse({ fail, value }) {
        if (value.trim() === '') {
          return fail('Expected a number.')
        }
        const result = Number(value)
        return Number.isFinite(result) ? result : fail(`Expected a number, received "${value}".`)
      }
    }),
    rest: createPrefixParser<TApp, 'rest', string>({
      consumption: 'rest',
      parse({ value }) {
        return value
      }
    }),
    Role: createPrefixParser<TApp, 'token', Role>({
      consumption: 'token',
      parse: parseRole
    }),
    string: createPrefixParser<TApp, 'token', string>({
      consumption: 'token',
      parse({ value }) {
        return value
      }
    }),
    User: createPrefixParser<TApp, 'token', User>({
      consumption: 'token',
      parse: parseUser
    })
  } as const
}

function mentionID(value: string, mentionPattern: RegExp): string | undefined {
  const mention = mentionPattern.exec(value)?.[1]
  if (mention !== undefined) {
    return mention
  }
  return /^\d+$/u.test(value) ? value : undefined
}

async function parseUser<TApp>({ fail, message, value }: PrefixParserContext<TApp>): Promise<User> {
  const id = mentionID(value, /^<@!?(\d+)>$/u)
  if (id === undefined) {
    return fail(`Could not resolve user "${value}".`)
  }
  const mentioned = message.mentions.users.find((user) => user.id === id)
  if (mentioned !== undefined) {
    return mentioned
  }
  const cached = message.client.users.get(id)
  if (cached !== undefined) {
    return cached
  }
  try {
    return await message.client.rest.users.get(id)
  } catch {
    return fail(`Could not resolve user "${value}".`)
  }
}

function parseRole<TApp>({ fail, message, value }: PrefixParserContext<TApp>): Role {
  const id = mentionID(value, /^<@&(\d+)>$/u)
  const guild = cachedMessageGuild(message)
  if (id === undefined || guild === undefined) {
    return fail(`Could not resolve role "${value}".`)
  }
  return guild.roles.get(id) ?? fail(`Could not resolve role "${value}".`)
}

function cachedMessageGuild(message: Message) {
  return message.guildID === null ? undefined : message.client.guilds.get(message.guildID)
}

/** Creates the throwing failure function passed to every parser context. */
export function createPrefixParserFail(): PrefixParserContext<unknown>['fail'] {
  return (message) => {
    throw new PrefixParserFailure(message)
  }
}
