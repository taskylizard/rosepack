import type { Message } from 'oceanic.js'
import type { RosepackTypeError } from './errors.ts'
import type { PrefixCommandContext } from './prefix-context.ts'
import type { PrefixCommandParseError } from './prefix-errors.ts'
import type { PrefixParserRecord } from './prefix-parsers.ts'
import type {
  PrefixFlagRecord,
  PrefixFlagValues,
  PrefixOptionValues,
  ValidatePrefixFlags,
  ValidatePrefixOptionSchema
} from './prefix-schema.ts'

const prefixCommandBrand = Symbol('rosepack.prefix-command')

/** Context supplied when routing or parsing fails before a command can execute. */
export interface PrefixCommandParseErrorContext<TApp> {
  readonly app: TApp
  readonly error: PrefixCommandParseError
  readonly message: Message
  readonly path: readonly string[]
}

/** Metadata and hooks shared by executable and routing-only prefix-command nodes. */
export interface PrefixCommandMetadata<TApp> {
  readonly aliases?: readonly string[]
  beforeExecute?(context: PrefixCommandContext<TApp, object, object>): void | Promise<void>
  readonly description?: string
  readonly name: string
  onError?(
    context: PrefixCommandContext<TApp, object, object>,
    error: unknown
  ): void | Promise<void>
  onParseError?(context: PrefixCommandParseErrorContext<TApp>): void | Promise<void>
}

/** Erased shape accepted by prefix registries and nested command arrays. */
export interface PrefixCommandDefinitionBase<TApp = unknown> extends PrefixCommandMetadata<TApp> {
  readonly [prefixCommandBrand]: true
  readonly flags?: PrefixFlagRecord
  readonly options?: string
  readonly subcommands?: readonly PrefixCommandDefinitionBase<TApp>[]
}

/** An executable prefix command returned by `prefix()`. */
export type PrefixExecutableCommandDefinition<
  TApp = unknown,
  TOptions extends object = {},
  TFlags extends object = {},
  TSubcommands extends readonly PrefixCommandDefinitionBase<TApp>[] | undefined = undefined
> = PrefixCommandDefinitionBase<TApp> & {
  beforeExecute?(context: PrefixCommandContext<TApp, TOptions, TFlags>): void | Promise<void>
  execute(context: PrefixCommandContext<TApp, TOptions, TFlags>): Promise<void>
  onError?(
    context: PrefixCommandContext<TApp, TOptions, TFlags>,
    error: unknown
  ): void | Promise<void>
} & ([TSubcommands] extends [undefined]
    ? { readonly subcommands?: undefined }
    : { readonly subcommands: TSubcommands })

/** A routing-only prefix node with one or more nested commands. */
export type PrefixRoutingCommandDefinition<
  TApp = unknown,
  TSubcommands extends readonly [
    PrefixCommandDefinitionBase<TApp>,
    ...PrefixCommandDefinitionBase<TApp>[]
  ] = readonly [PrefixCommandDefinitionBase<TApp>, ...PrefixCommandDefinitionBase<TApp>[]]
> = PrefixCommandDefinitionBase<TApp> & {
  readonly flags?: never
  readonly options?: never
  readonly subcommands: TSubcommands
}

/** Any executable or routing-only definition returned by `prefix()`. */
export type PrefixCommandDefinition<TApp = unknown> =
  | PrefixExecutableCommandDefinition<
      TApp,
      object,
      object,
      readonly PrefixCommandDefinitionBase<TApp>[] | undefined
    >
  | PrefixRoutingCommandDefinition<TApp>

interface PrefixCommandTypeShape {
  readonly aliases?: readonly string[]
  readonly name: string
  readonly subcommands?: readonly PrefixCommandTypeShape[]
}

type PrefixCommandTokens<TCommand> = TCommand extends {
  aliases?: infer TAliases
  name: infer TName extends string
}
  ? TName | (TAliases extends readonly string[] ? TAliases[number] : never)
  : never

type ValidatePrefixCommandNode<TCommand> = TCommand extends {
  subcommands: infer TSubcommands extends readonly PrefixCommandTypeShape[]
}
  ? ValidatePrefixCommandDefinitions<TSubcommands>
  : true

type ValidatePrefixCommandDefinitionTuple<
  TCommands extends readonly PrefixCommandTypeShape[],
  TSeen extends string = never
> = TCommands extends readonly [
  infer TFirst extends PrefixCommandTypeShape,
  ...infer TRest extends readonly PrefixCommandTypeShape[]
]
  ? Extract<Lowercase<PrefixCommandTokens<TFirst>>, TSeen> extends infer Conflict extends string
    ? [Conflict] extends [never]
      ? ValidatePrefixCommandNode<TFirst> extends true
        ? ValidatePrefixCommandDefinitionTuple<
            TRest,
            TSeen | Lowercase<PrefixCommandTokens<TFirst>>
          >
        : ValidatePrefixCommandNode<TFirst>
      : RosepackTypeError<`Duplicate prefix command name or alias "${Conflict}".`>
    : true
  : true

/** Returns `true` or a readable duplicate-name error for a literal prefix command tree. */
export type ValidatePrefixCommandDefinitions<TCommands extends readonly PrefixCommandTypeShape[]> =
  number extends TCommands['length'] ? true : ValidatePrefixCommandDefinitionTuple<TCommands>

type PrefixDefinitionStaticValidation<
  TSchema extends string,
  TFlags extends PrefixFlagRecord,
  TParsers extends PrefixParserRecord<unknown>
> = (ValidatePrefixOptionSchema<TSchema, TParsers> extends true
  ? unknown
  : ValidatePrefixOptionSchema<TSchema, TParsers>) &
  (ValidatePrefixFlags<TFlags, TParsers> extends true
    ? unknown
    : ValidatePrefixFlags<TFlags, TParsers>)

/** Executable input object accepted by the scoped `prefix()` builder. */
export type PrefixExecutableCommandInput<
  TApp,
  TSchema extends string,
  TFlags extends PrefixFlagRecord,
  TParsers extends PrefixParserRecord<unknown>,
  TSubcommands extends readonly PrefixCommandDefinitionBase<TApp>[] | undefined
> = Omit<PrefixCommandMetadata<TApp>, 'beforeExecute' | 'onError'> & {
  beforeExecute?(
    context: PrefixCommandContext<
      TApp,
      PrefixOptionValues<TSchema, TParsers>,
      PrefixFlagValues<TFlags, TParsers>
    >
  ): void | Promise<void>
  execute(
    context: PrefixCommandContext<
      TApp,
      PrefixOptionValues<TSchema, TParsers>,
      PrefixFlagValues<TFlags, TParsers>
    >
  ): Promise<void>
  readonly flags?: TFlags
  onError?(
    context: PrefixCommandContext<
      TApp,
      PrefixOptionValues<TSchema, TParsers>,
      PrefixFlagValues<TFlags, TParsers>
    >,
    error: unknown
  ): void | Promise<void>
  readonly options?: TSchema
  readonly subcommands?: TSubcommands
} & PrefixDefinitionStaticValidation<TSchema, TFlags, TParsers>

/** Routing-only input object accepted by the scoped `prefix()` builder. */
export type PrefixRoutingCommandInput<
  TApp,
  TSubcommands extends readonly [
    PrefixCommandDefinitionBase<TApp>,
    ...PrefixCommandDefinitionBase<TApp>[]
  ]
> = PrefixCommandMetadata<TApp> & {
  readonly flags?: never
  readonly options?: never
  readonly subcommands: TSubcommands
}

type PrefixLiteralNames<TName extends string, TAliases extends readonly string[] | undefined> = {
  readonly name: TName
} & ([TAliases] extends [undefined]
  ? { readonly aliases?: undefined }
  : { readonly aliases: TAliases })

/** A command builder bound to one app type and one parser dictionary. */
export interface PrefixCommandBuilder<TApp, TParsers extends PrefixParserRecord<unknown>> {
  <
    const TName extends string,
    const TAliases extends readonly string[] | undefined = undefined,
    const TSchema extends string = '',
    const TFlags extends PrefixFlagRecord = {},
    const TSubcommands extends readonly PrefixCommandDefinitionBase<TApp>[] | undefined = undefined
  >(
    definition: PrefixExecutableCommandInput<TApp, TSchema, TFlags, TParsers, TSubcommands> &
      PrefixLiteralNames<TName, TAliases>
  ): PrefixExecutableCommandDefinition<
    TApp,
    PrefixOptionValues<TSchema, TParsers>,
    PrefixFlagValues<TFlags, TParsers>,
    TSubcommands
  > &
    PrefixLiteralNames<TName, TAliases>
  <
    const TName extends string,
    const TSubcommands extends readonly [
      PrefixCommandDefinitionBase<TApp>,
      ...PrefixCommandDefinitionBase<TApp>[]
    ],
    const TAliases extends readonly string[] | undefined = undefined
  >(
    definition: PrefixRoutingCommandInput<TApp, TSubcommands> & PrefixLiteralNames<TName, TAliases>
  ): PrefixRoutingCommandDefinition<TApp, TSubcommands> & PrefixLiteralNames<TName, TAliases>
}

type PrefixCommandExecutor = (
  context: PrefixCommandContext<unknown, object, object>
) => Promise<void>

const prefixExecutors = new WeakMap<object, PrefixCommandExecutor>()

export function getPrefixCommandExecutor(definition: object): PrefixCommandExecutor | undefined {
  return prefixExecutors.get(definition)
}

type RuntimePrefixCommandInput = Omit<PrefixCommandDefinitionBase, typeof prefixCommandBrand> & {
  execute?: (context: PrefixCommandContext<unknown, object, object>) => Promise<void>
}

/** Runtime implementation behind every scoped `prefix()` builder. */
export function createPrefixCommandDefinition(
  definition: RuntimePrefixCommandInput
): PrefixCommandDefinitionBase {
  const result = {
    ...definition,
    [prefixCommandBrand]: true
  } as PrefixCommandDefinitionBase
  if (definition.execute !== undefined) {
    prefixExecutors.set(result, (context) => definition.execute!(context))
  }
  return result
}

/** Compile-time helper for surfacing a custom prefix-definition error. */
export type PrefixDefinitionError<TMessage extends string> = RosepackTypeError<TMessage>

/** An immutable searchable view of one prefix-command node. */
export interface PrefixCommandTreeNode<TApp = unknown> {
  readonly aliases: readonly string[]
  readonly children: readonly PrefixCommandTreeNode<TApp>[]
  readonly definition: PrefixCommandDefinitionBase<TApp>
  readonly description?: string
  readonly executable: boolean
  readonly name: string
  readonly path: readonly string[]
}
