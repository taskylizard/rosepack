import type { RosepackTypeError } from './errors.ts'
import type {
  PrefixOptionParser,
  PrefixParserConsumption,
  PrefixParserConsumptionOf,
  PrefixParserOutput,
  PrefixParserRecord
} from './prefix-parsers.ts'

const maximumPrefixSchemaLength = 4_096

type Whitespace = ' ' | '\n' | '\r' | '\t'
type TrimLeft<TValue extends string> = TValue extends `${Whitespace}${infer Rest}`
  ? TrimLeft<Rest>
  : TValue
type TrimRight<TValue extends string> = TValue extends `${infer Rest}${Whitespace}`
  ? TrimRight<Rest>
  : TValue
type Trim<TValue extends string> = TrimLeft<TrimRight<TValue>>
type Simplify<TValue> = { -readonly [Key in keyof TValue]: TValue[Key] }

type AddPrefixOption<
  TSegment extends string,
  TTail extends string,
  TParsers extends PrefixParserRecord<unknown>,
  TOptions,
  TOptionalSeen extends boolean,
  TCount extends unknown[]
> =
  Trim<TSegment> extends `${infer RawName}?:${infer RawParser}`
    ? AddParsedPrefixOption<
        Trim<RawName>,
        Trim<RawParser>,
        TTail,
        TParsers,
        TOptions,
        true,
        true,
        TCount
      >
    : Trim<TSegment> extends `${infer RawName}:${infer RawParser}`
      ? AddParsedPrefixOption<
          Trim<RawName>,
          Trim<RawParser>,
          TTail,
          TParsers,
          TOptions,
          false,
          TOptionalSeen,
          TCount
        >
      : RosepackTypeError<`Invalid prefix option segment "${TSegment}". Expected [name: Parser].`>

type AddParsedPrefixOption<
  TName extends string,
  TParserName extends string,
  TTail extends string,
  TParsers extends PrefixParserRecord<unknown>,
  TOptions,
  TOptional extends boolean,
  TOptionalSeen extends boolean,
  TCount extends unknown[]
> = TName extends ''
  ? RosepackTypeError<'Prefix option names cannot be empty.'>
  : TName extends keyof TOptions
    ? RosepackTypeError<`Duplicate prefix option "${TName}".`>
    : TParserName extends keyof TParsers
      ? TOptionalSeen extends true
        ? TOptional extends false
          ? RosepackTypeError<`Required prefix option "${TName}" cannot follow an optional option.`>
          : AddKnownPrefixOption<
              TName,
              TParserName,
              TTail,
              TParsers,
              TOptions,
              TOptional,
              TOptionalSeen,
              TCount
            >
        : AddKnownPrefixOption<
            TName,
            TParserName,
            TTail,
            TParsers,
            TOptions,
            TOptional,
            TOptionalSeen,
            TCount
          >
      : RosepackTypeError<`Unknown prefix option parser "${TParserName}".`>

type AddKnownPrefixOption<
  TName extends string,
  TParserName extends keyof TParsers,
  TTail extends string,
  TParsers extends PrefixParserRecord<unknown>,
  TOptions,
  TOptional extends boolean,
  TOptionalSeen extends boolean,
  TCount extends unknown[]
> =
  PrefixParserConsumptionOf<TParsers[TParserName]> extends 'rest'
    ? Trim<TTail> extends ''
      ? Simplify<
          TOptions &
            (TOptional extends true
              ? { [Key in TName]?: PrefixParserOutput<TParsers[TParserName]> }
              : { [Key in TName]: PrefixParserOutput<TParsers[TParserName]> })
        >
      : RosepackTypeError<`Rest-consuming prefix option "${TName}" must be last.`>
    : ParsePrefixOptionSchema<
        TTail,
        TParsers,
        TOptions &
          (TOptional extends true
            ? { [Key in TName]?: PrefixParserOutput<TParsers[TParserName]> }
            : { [Key in TName]: PrefixParserOutput<TParsers[TParserName]> }),
        TOptionalSeen,
        [...TCount, unknown]
      >

type ParsePrefixOptionSchema<
  TSchema extends string,
  TParsers extends PrefixParserRecord<unknown>,
  TOptions = {},
  TOptionalSeen extends boolean = false,
  TCount extends unknown[] = []
> = string extends TSchema
  ? RosepackTypeError<'Prefix option schemas must be string literals, not the widened string type.'>
  : TCount['length'] extends 32
    ? RosepackTypeError<'Prefix commands support at most 32 positional options.'>
    : Trim<TSchema> extends ''
      ? Simplify<TOptions>
      : Trim<TSchema> extends `[${infer Segment}]${infer Tail}`
        ? AddPrefixOption<Segment, Tail, TParsers, TOptions, TOptionalSeen, TCount>
        : RosepackTypeError<`Invalid prefix options schema near "${Trim<TSchema>}".`>

type PrefixOptionSchemaResult<
  TSchema extends string,
  TParsers extends PrefixParserRecord<unknown>
> = ParsePrefixOptionSchema<TSchema, TParsers>

/** Infers the handler option object produced by a prefix options schema. */
export type PrefixOptionValues<
  TSchema extends string,
  TParsers extends PrefixParserRecord<unknown>
> =
  PrefixOptionSchemaResult<TSchema, TParsers> extends RosepackTypeError<string>
    ? never
    : PrefixOptionSchemaResult<TSchema, TParsers>

/** Returns `true` or a readable compile-time schema error. */
export type ValidatePrefixOptionSchema<
  TSchema extends string,
  TParsers extends PrefixParserRecord<unknown>
> =
  PrefixOptionSchemaResult<TSchema, TParsers> extends RosepackTypeError<infer Message>
    ? RosepackTypeError<Message>
    : true

/** A boolean switch such as `--force` or `-f`. */
export interface PrefixBooleanFlagDefinition {
  readonly aliases?: readonly string[]
  readonly description?: string
  readonly kind: 'boolean'
}

/** A flag followed by a value parsed by one token-consuming parser. */
export interface PrefixValueFlagDefinition {
  readonly aliases?: readonly string[]
  readonly description?: string
  readonly multiple?: boolean
  readonly parser: string
  readonly required?: boolean
}

/** Any supported prefix flag definition. */
export type PrefixFlagDefinition = PrefixBooleanFlagDefinition | PrefixValueFlagDefinition

/** A canonical-flag-name-to-definition map. */
export interface PrefixFlagRecord {
  [name: string]: PrefixFlagDefinition
}

type PrefixFlagValue<
  TFlag extends PrefixFlagDefinition,
  TParsers extends PrefixParserRecord<unknown>
> = TFlag extends PrefixBooleanFlagDefinition
  ? boolean
  : TFlag extends { parser: infer TParserName extends keyof TParsers }
    ? TFlag extends { multiple: true }
      ? TFlag extends { required: true }
        ? readonly [
            PrefixParserOutput<TParsers[TParserName]>,
            ...PrefixParserOutput<TParsers[TParserName]>[]
          ]
        : readonly PrefixParserOutput<TParsers[TParserName]>[]
      : PrefixParserOutput<TParsers[TParserName]>
    : never

type RequiredPrefixFlagNames<TFlags extends PrefixFlagRecord> = {
  [Name in keyof TFlags]-?: TFlags[Name] extends PrefixBooleanFlagDefinition
    ? Name
    : TFlags[Name] extends { multiple: true } | { required: true }
      ? Name
      : never
}[keyof TFlags]

/** Infers boolean, required, optional, and repeated flag values. */
export type PrefixFlagValues<
  TFlags extends PrefixFlagRecord,
  TParsers extends PrefixParserRecord<unknown>
> = Simplify<
  {
    [Name in RequiredPrefixFlagNames<TFlags>]: PrefixFlagValue<TFlags[Name], TParsers>
  } & {
    [Name in Exclude<keyof TFlags, RequiredPrefixFlagNames<TFlags>>]?: PrefixFlagValue<
      TFlags[Name],
      TParsers
    >
  }
>

type ValidatePrefixFlag<
  TName extends PropertyKey,
  TFlag extends PrefixFlagDefinition,
  TParsers extends PrefixParserRecord<unknown>
> = TFlag extends PrefixBooleanFlagDefinition
  ? true
  : TFlag extends PrefixValueFlagDefinition
    ? TFlag['parser'] extends keyof TParsers
      ? PrefixParserConsumptionOf<TParsers[TFlag['parser']]> extends 'token'
        ? true
        : RosepackTypeError<`Prefix flag "${Extract<TName, string>}" cannot use a rest-consuming parser.`>
      : RosepackTypeError<`Prefix flag "${Extract<TName, string>}" uses unknown parser "${TFlag['parser']}".`>
    : never

type PrefixFlagTokens<TName extends PropertyKey, TFlag extends PrefixFlagDefinition> =
  | Extract<TName, string>
  | Extract<TFlag['aliases'], readonly string[]>[number]

type OtherPrefixFlagTokens<TFlags extends PrefixFlagRecord, TName extends keyof TFlags> = {
  [OtherName in Exclude<keyof TFlags, TName>]: PrefixFlagTokens<OtherName, TFlags[OtherName]>
}[Exclude<keyof TFlags, TName>]

type ValidatePrefixFlagNames<TFlags extends PrefixFlagRecord, TName extends keyof TFlags> =
  Extract<
    Lowercase<PrefixFlagTokens<TName, TFlags[TName]>>,
    Lowercase<OtherPrefixFlagTokens<TFlags, TName>>
  > extends infer Conflict extends string
    ? [Conflict] extends [never]
      ? true
      : RosepackTypeError<`Duplicate prefix flag name or alias "${Conflict}".`>
    : true

/** Returns `true` or the union of readable compile-time flag errors. */
export type ValidatePrefixFlags<
  TFlags extends PrefixFlagRecord,
  TParsers extends PrefixParserRecord<unknown>
> =
  Exclude<
    {
      [Name in keyof TFlags]:
        | ValidatePrefixFlag<Name, TFlags[Name], TParsers>
        | ValidatePrefixFlagNames<TFlags, Name>
    }[keyof TFlags],
    true
  > extends never
    ? true
    : Exclude<
        {
          [Name in keyof TFlags]:
            | ValidatePrefixFlag<Name, TFlags[Name], TParsers>
            | ValidatePrefixFlagNames<TFlags, Name>
        }[keyof TFlags],
        true
      >

/** One positional option compiled from the schema string for runtime parsing. */
export interface CompiledPrefixOption {
  readonly name: string
  readonly optional: boolean
  readonly parser: string
}

/** Parses and validates a prefix options schema at registry-construction time. */
export function compilePrefixOptionSchema<TApp>(
  schema: string,
  parsers: PrefixParserRecord<TApp>
): CompiledPrefixOption[] {
  if (schema.length > maximumPrefixSchemaLength) {
    throw new Error(`Prefix option schemas cannot exceed ${maximumPrefixSchemaLength} characters.`)
  }
  const options: CompiledPrefixOption[] = []
  const names = new Set<string>()
  let index = 0
  let optionalSeen = false

  while (index < schema.length) {
    while (isWhitespaceCode(schema.charCodeAt(index))) {
      index += 1
    }
    if (index >= schema.length) {
      break
    }
    if (schema[index] !== '[') {
      throw new Error(`Invalid prefix options schema near "${schema.slice(index)}".`)
    }
    const end = schema.indexOf(']', index + 1)
    if (end === -1) {
      throw new Error(`Unclosed prefix option segment near "${schema.slice(index)}".`)
    }
    const segment = schema.slice(index + 1, end).trim()
    const colon = segment.indexOf(':')
    if (colon === -1) {
      throw new Error(`Invalid prefix option segment "${segment}". Expected [name: Parser].`)
    }
    const rawName = segment.slice(0, colon).trim()
    const optional = rawName.endsWith('?')
    const name = (optional ? rawName.slice(0, -1) : rawName).trim()
    const parser = segment.slice(colon + 1).trim()
    if (!/^[A-Za-z_$][\w$]*$/u.test(name)) {
      throw new Error(`Invalid prefix option name "${name}".`)
    }
    if (names.has(name)) {
      throw new Error(`Duplicate prefix option "${name}".`)
    }
    // tasky: Own-key checks stop inherited names like `toString` from becoming fake parsers.
    if (!Object.hasOwn(parsers, parser)) {
      throw new Error(`Unknown prefix option parser "${parser}".`)
    }
    if (!optional && optionalSeen) {
      throw new Error(`Required prefix option "${name}" cannot follow an optional option.`)
    }
    optionalSeen ||= optional
    if (parsers[parser]!.consumption === 'rest' && schema.slice(end + 1).trim() !== '') {
      throw new Error(`Rest-consuming prefix option "${name}" must be last.`)
    }
    names.add(name)
    options.push(Object.freeze({ name, optional, parser }))
    if (options.length > 32) {
      throw new Error('Prefix commands support at most 32 positional options.')
    }
    index = end + 1
  }

  return options
}

function isWhitespaceCode(code: number): boolean {
  if (code === 32 || (code >= 9 && code <= 13)) {
    return true
  }
  return code > 127 && /\s/u.test(String.fromCharCode(code))
}

/** Erased parser constraint used by command and registry internals. */
export type AnyPrefixParserRecord = Record<
  string,
  PrefixOptionParser<unknown, unknown, PrefixParserConsumption>
>
