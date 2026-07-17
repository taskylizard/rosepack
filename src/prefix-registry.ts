import type { Message } from 'oceanic.js'
import {
  createPrefixCommandDefinition,
  getPrefixCommandExecutor,
  type PrefixCommandBuilder,
  type PrefixCommandDefinitionBase,
  type PrefixCommandParseErrorContext,
  type PrefixCommandTreeNode,
  type PrefixExecutableCommandDefinition,
  type ValidatePrefixCommandDefinitions
} from './prefix-commands.ts'
import { PrefixCommandContext } from './prefix-context.ts'
import {
  PrefixCommandParseError,
  PrefixCommandValidationError,
  PrefixParserFailure,
  type PrefixCommandValidationIssue
} from './prefix-errors.ts'
import { invokePrefixRegistryCommand, prefixInvocationTrail } from './prefix-internal.ts'
import {
  createDefaultPrefixParsers,
  createPrefixParserFail,
  type DefaultPrefixParsers,
  type PrefixOptionParser,
  type PrefixParserConsumption,
  type PrefixParserContext,
  type PrefixParserRecord
} from './prefix-parsers.ts'
import {
  compilePrefixOptionSchema,
  type CompiledPrefixOption,
  type PrefixFlagDefinition,
  type PrefixFlagRecord
} from './prefix-schema.ts'
import { tokenizePrefixInput, type PrefixToken } from './prefix-tokenizer.ts'

/** Prefixes can be static or selected per message and application context. */
export type PrefixResolver<TApp> =
  | readonly string[]
  | string
  | ((context: {
      app: TApp
      message: Message
    }) => Promise<readonly string[] | string | undefined> | readonly string[] | string | undefined)

/** Dispatch and failure behavior for one prefix-command registry. */
export interface PrefixCommandRegistryOptions<TApp> {
  readonly caseSensitive?: boolean
  readonly ignoreBots?: boolean
  readonly ignoreWebhooks?: boolean
  onParseError?(context: PrefixCommandParseErrorContext<TApp>): void | Promise<void>
  readonly prefixes: PrefixResolver<TApp>
  onUnknownCommand?(context: {
    app: TApp
    commandName: string
    message: Message
    prefix: string
    registry: PrefixCommandRegistry<TApp>
  }): void | Promise<void>
}

interface CompiledPrefixFlag {
  readonly definition: PrefixFlagDefinition
  readonly name: string
  readonly parser?: PrefixOptionParser<unknown, unknown, 'token'>
}

interface RuntimePrefixNode<TApp> {
  readonly ancestors: readonly RuntimePrefixNode<TApp>[]
  readonly childrenByName: ReadonlyMap<string, RuntimePrefixNode<TApp>>
  readonly flags: readonly CompiledPrefixFlag[]
  readonly flagsByName: ReadonlyMap<string, CompiledPrefixFlag>
  readonly options: readonly CompiledPrefixOption[]
  readonly public: PrefixCommandTreeNode<TApp>
}

interface ParsedPrefixValues {
  readonly flags: Readonly<Record<string, unknown>>
  readonly options: Readonly<Record<string, unknown>>
}

const emptyParsedValues = Object.freeze(Object.create(null)) as Readonly<Record<string, unknown>>

/** A validated, immutable, and dispatchable prefix-command tree. */
export class PrefixCommandRegistry<TApp> {
  readonly tree: readonly PrefixCommandTreeNode<TApp>[]
  readonly #byDefinition: WeakMap<object, RuntimePrefixNode<TApp>>
  readonly #byPath: ReadonlyMap<string, RuntimePrefixNode<TApp>>
  readonly #options: PrefixCommandRegistryOptions<TApp>
  readonly #parsers: PrefixParserRecord<TApp>
  readonly #rootsByName: ReadonlyMap<string, RuntimePrefixNode<TApp>>
  readonly #runtimeByPublic: WeakMap<PrefixCommandTreeNode<TApp>, RuntimePrefixNode<TApp>>

  constructor(config: {
    byDefinition: WeakMap<object, RuntimePrefixNode<TApp>>
    byPath: ReadonlyMap<string, RuntimePrefixNode<TApp>>
    options: PrefixCommandRegistryOptions<TApp>
    parsers: PrefixParserRecord<TApp>
    rootsByName: ReadonlyMap<string, RuntimePrefixNode<TApp>>
    runtimeByPublic: WeakMap<PrefixCommandTreeNode<TApp>, RuntimePrefixNode<TApp>>
    tree: readonly PrefixCommandTreeNode<TApp>[]
  }) {
    this.#byDefinition = config.byDefinition
    this.#byPath = config.byPath
    this.#options = config.options
    this.#parsers = config.parsers
    this.#rootsByName = config.rootsByName
    this.#runtimeByPublic = config.runtimeByPublic
    this.tree = config.tree
    Object.freeze(this)
  }

  /** Finds a root by canonical name or alias, or any node by its definition object. */
  get(name: string): PrefixCommandTreeNode<TApp> | undefined
  get(definition: PrefixCommandDefinitionBase<TApp>): PrefixCommandTreeNode<TApp> | undefined
  get(
    selector: PrefixCommandDefinitionBase<TApp> | string
  ): PrefixCommandTreeNode<TApp> | undefined {
    if (typeof selector === 'string') {
      return this.#rootsByName.get(normalizeName(selector, this.#options.caseSensitive))?.public
    }
    return this.#byDefinition.get(selector)?.public
  }

  /** Resolves a whitespace-separated canonical or aliased command path. */
  resolve(path: readonly string[] | string): PrefixCommandTreeNode<TApp> | undefined {
    const segments =
      typeof path === 'string' ? path.trim().split(/\s+/u).filter(Boolean) : [...path]
    if (segments.length === 0) {
      return undefined
    }
    let node = this.#rootsByName.get(normalizeName(segments[0]!, this.#options.caseSensitive))
    for (const segment of segments.slice(1)) {
      node = node?.childrenByName.get(normalizeName(segment, this.#options.caseSensitive))
      if (node === undefined) {
        return undefined
      }
    }
    return node?.public
  }

  /** Parses and dispatches one Oceanic message. Returns whether a known command handled it. */
  async dispatch(config: { app: TApp; message: Message }): Promise<boolean> {
    const { app, message } = config
    if ((this.#options.ignoreBots ?? true) && message.author.bot) {
      return false
    }
    if ((this.#options.ignoreWebhooks ?? true) && message.webhookID !== undefined) {
      return false
    }

    const matchedPrefix = await resolveMessagePrefix(this.#options.prefixes, app, message)
    if (matchedPrefix === undefined) {
      return false
    }
    const commandInput = message.content.slice(matchedPrefix.length).trimStart()
    if (commandInput === '') {
      return false
    }

    let tokens: PrefixToken[]
    try {
      tokens = tokenizePrefixInput(commandInput)
    } catch (error) {
      if (error instanceof PrefixCommandParseError) {
        await this.#handleParseError(app, message, undefined, error)
        return true
      }
      throw error
    }
    const rootToken = tokens[0]
    if (rootToken === undefined) {
      return false
    }
    const root = this.#rootsByName.get(normalizeName(rootToken.value, this.#options.caseSensitive))
    if (root === undefined) {
      await this.#options.onUnknownCommand?.({
        app,
        commandName: rootToken.value,
        message,
        prefix: matchedPrefix,
        registry: this
      })
      return false
    }

    let node = root
    let consumed = 1
    while (consumed < tokens.length) {
      const child = node.childrenByName.get(
        normalizeName(tokens[consumed]!.value, this.#options.caseSensitive)
      )
      if (child === undefined) {
        break
      }
      node = child
      consumed += 1
    }

    if (!node.public.executable) {
      const unexpected = tokens[consumed]
      const error = new PrefixCommandParseError({
        code: unexpected === undefined ? 'missing-subcommand' : 'unknown-subcommand',
        input: unexpected?.value,
        message:
          unexpected === undefined
            ? `Command "${node.public.path.join(' ')}" requires a subcommand.`
            : `Unknown subcommand "${unexpected.value}" for "${node.public.path.join(' ')}".`,
        path: node.public.path
      })
      await this.#handleParseError(app, message, node, error)
      return true
    }

    const argumentTokens = tokens.slice(consumed)
    const rawArguments =
      argumentTokens[0] === undefined ? '' : commandInput.slice(argumentTokens[0].start)
    let values: ParsedPrefixValues
    try {
      values = await parsePrefixValues({
        app,
        message,
        node,
        parsers: this.#parsers,
        tokens: argumentTokens
      })
    } catch (error) {
      if (error instanceof PrefixCommandParseError) {
        await this.#handleParseError(app, message, node, error)
        return true
      }
      throw error
    }

    await this.#execute({
      app,
      flags: values.flags,
      invocationTrail: [node.public.definition],
      message,
      node,
      options: values.options,
      prefix: matchedPrefix,
      rawArguments,
      root
    })
    return true
  }

  async [invokePrefixRegistryCommand](
    source: PrefixCommandContext<TApp, object, object>,
    target: PrefixExecutableCommandDefinition<TApp, object, object> | PrefixCommandTreeNode<TApp>,
    values: {
      flags: Readonly<Record<string, unknown>>
      options: Readonly<Record<string, unknown>>
    }
  ): Promise<void> {
    const node =
      'definition' in target
        ? this.#runtimeByPublic.get(target)
        : this.#byDefinition.get(target as PrefixCommandDefinitionBase<TApp>)
    if (node === undefined) {
      throw new Error('Cannot invoke a prefix command that is not in this registry.')
    }
    if (!node.public.executable) {
      throw new Error(`Prefix command "${node.public.path.join(' ')}" is not executable.`)
    }
    if (source[prefixInvocationTrail].includes(node.public.definition)) {
      throw new Error(
        `Recursive prefix command invocation detected at "${node.public.path.join(' ')}".`
      )
    }
    validateInvokedValues(node, values)
    const root = this.#byPath.get(pathKey([node.public.path[0]!]))
    if (root === undefined) {
      throw new Error(`Prefix command root "${node.public.path[0]}" is missing.`)
    }
    await this.#execute({
      app: source.app,
      flags: freezeRecord(values.flags),
      invocationTrail: [...source[prefixInvocationTrail], node.public.definition],
      message: source.message,
      node,
      options: freezeRecord(values.options),
      prefix: source.prefix,
      rawArguments: '',
      root
    })
  }

  async #execute(config: {
    app: TApp
    flags: Readonly<Record<string, unknown>>
    invocationTrail: readonly PrefixCommandDefinitionBase<TApp>[]
    message: Message
    node: RuntimePrefixNode<TApp>
    options: Readonly<Record<string, unknown>>
    prefix: string
    rawArguments: string
    root: RuntimePrefixNode<TApp>
  }): Promise<void> {
    const context = new PrefixCommandContext({
      app: config.app,
      command: config.root.public,
      flags: config.flags,
      invocationTrail: config.invocationTrail,
      message: config.message,
      node: config.node.public,
      options: config.options,
      prefix: config.prefix,
      rawArguments: config.rawArguments,
      registry: this
    })
    try {
      for (const ancestor of [...config.node.ancestors, config.node]) {
        await ancestor.public.definition.beforeExecute?.(context)
      }
      const executor = getPrefixCommandExecutor(config.node.public.definition)
      if (executor === undefined) {
        throw new Error(`Prefix command "${config.node.public.path.join(' ')}" has no executor.`)
      }
      await executor(context as PrefixCommandContext<unknown, object, object>)
    } catch (error) {
      for (const candidate of [config.node, ...config.node.ancestors.toReversed()]) {
        if (candidate.public.definition.onError !== undefined) {
          await candidate.public.definition.onError(context, error)
          return
        }
      }
      throw error
    }
  }

  async #handleParseError(
    app: TApp,
    message: Message,
    node: RuntimePrefixNode<TApp> | undefined,
    error: PrefixCommandParseError
  ): Promise<void> {
    const context = {
      app,
      error,
      message,
      path: node?.public.path ?? error.path
    }
    if (node !== undefined) {
      for (const candidate of [node, ...node.ancestors.toReversed()]) {
        if (candidate.public.definition.onParseError !== undefined) {
          await candidate.public.definition.onParseError(context)
          return
        }
      }
    }
    if (this.#options.onParseError !== undefined) {
      await this.#options.onParseError(context)
      return
    }
    throw error
  }
}

type MergePrefixParsers<TApp, TCustom extends PrefixParserRecord<TApp>> = Omit<
  DefaultPrefixParsers<TApp>,
  keyof TCustom
> &
  TCustom

/** The scoped builder, parser dictionary, linter, and registry factory for prefix commands. */
export interface PrefixCommands<TApp, TParsers extends PrefixParserRecord<TApp>> {
  createCompiledRegistry(
    commands: readonly PrefixCommandDefinitionBase<TApp>[],
    options: PrefixCommandRegistryOptions<TApp>
  ): PrefixCommandRegistry<TApp>
  createRegistry<const TCommands extends readonly PrefixCommandDefinitionBase<TApp>[]>(
    commands: TCommands &
      (ValidatePrefixCommandDefinitions<TCommands> extends true
        ? unknown
        : ValidatePrefixCommandDefinitions<TCommands>),
    options: PrefixCommandRegistryOptions<TApp>
  ): PrefixCommandRegistry<TApp>
  lint(commands: readonly PrefixCommandDefinitionBase<TApp>[]): PrefixCommandValidationIssue[]
  readonly parsers: TParsers
  readonly prefix: PrefixCommandBuilder<TApp, TParsers>
}

/** A factory bound to the app type that can extend the default parser dictionary. */
export interface CreatePrefixCommands<TApp> {
  <const TCustom extends PrefixParserRecord<TApp> = {}>(options?: {
    readonly parsers?: TCustom
  }): PrefixCommands<TApp, MergePrefixParsers<TApp, TCustom>>
}

/** Creates one typed prefix-command scope. Usually accessed through `createRosepack()`. */
export function createPrefixCommands<TApp, const TCustom extends PrefixParserRecord<TApp> = {}>(
  options: { readonly parsers?: TCustom } = {}
): PrefixCommands<TApp, MergePrefixParsers<TApp, TCustom>> {
  const parsers = Object.create(null) as MergePrefixParsers<TApp, TCustom>
  // tasky: Null-prototype parser tables make string DSL lookups immune to prototype keys.
  Object.assign(parsers, createDefaultPrefixParsers<TApp>(), options.parsers ?? {})
  for (const parser of Object.values(parsers)) {
    Object.freeze(parser)
  }
  Object.freeze(parsers)
  const scope: PrefixCommands<TApp, MergePrefixParsers<TApp, TCustom>> = {
    createCompiledRegistry: (commands, registryOptions) =>
      buildCompiledPrefixCommandTree(commands, parsers, registryOptions),
    createRegistry: (commands, registryOptions) =>
      buildPrefixCommandTree(commands, parsers, registryOptions),
    lint: (commands) => lintPrefixCommandTree(commands, parsers),
    parsers,
    prefix: createPrefixCommandDefinition as PrefixCommandBuilder<
      TApp,
      MergePrefixParsers<TApp, TCustom>
    >
  }
  return Object.freeze(scope)
}

/** Validates and builds a frozen prefix-command registry. */
export function buildPrefixCommandTree<TApp>(
  commands: readonly PrefixCommandDefinitionBase<TApp>[],
  parsers: PrefixParserRecord<TApp>,
  options: PrefixCommandRegistryOptions<TApp>
): PrefixCommandRegistry<TApp> {
  const issues = lintPrefixCommandTree(commands, parsers)
  if (issues.length > 0) {
    throw new PrefixCommandValidationError(issues)
  }
  return buildCompiledPrefixCommandTree(commands, parsers, options)
}

/** Builds a registry from compiler-validated prefix commands without repeating lint checks. */
export function buildCompiledPrefixCommandTree<TApp>(
  commands: readonly PrefixCommandDefinitionBase<TApp>[],
  parsers: PrefixParserRecord<TApp>,
  options: PrefixCommandRegistryOptions<TApp>
): PrefixCommandRegistry<TApp> {
  const byDefinition = new WeakMap<object, RuntimePrefixNode<TApp>>()
  const byPath = new Map<string, RuntimePrefixNode<TApp>>()
  const runtimeByPublic = new WeakMap<PrefixCommandTreeNode<TApp>, RuntimePrefixNode<TApp>>()
  const seenDefinitions = new WeakSet<object>()
  const roots = commands.map((command) =>
    buildRuntimeNode({
      ancestors: [],
      byDefinition,
      byPath,
      command,
      options,
      parentPath: [],
      parsers,
      runtimeByPublic,
      seenDefinitions
    })
  )
  const rootsByName = createNameMap(roots, options.caseSensitive)
  for (const command of commands) {
    freezePrefixDefinition(command)
  }
  return new PrefixCommandRegistry({
    byDefinition,
    byPath,
    options,
    parsers,
    rootsByName,
    runtimeByPublic,
    tree: Object.freeze(roots.map((root) => root.public))
  })
}

/** Returns all prefix tree, schema, parser, flag, and alias problems without throwing. */
export function lintPrefixCommandTree<TApp>(
  commands: readonly PrefixCommandDefinitionBase<TApp>[],
  parsers: PrefixParserRecord<TApp>
): PrefixCommandValidationIssue[] {
  const issues: PrefixCommandValidationIssue[] = []
  const definitions = new WeakSet<object>()
  validateSiblingCommands(commands, [], parsers, issues, definitions, 0)
  return issues
}

function validateSiblingCommands<TApp>(
  commands: readonly PrefixCommandDefinitionBase<TApp>[],
  parentPath: readonly string[],
  parsers: PrefixParserRecord<TApp>,
  issues: PrefixCommandValidationIssue[],
  definitions: WeakSet<object>,
  depth: number
): void {
  if (commands.length === 0) {
    addIssue(issues, parentPath, 'empty-subcommands', 'A prefix command group cannot be empty.')
    return
  }
  if (depth > 32) {
    addIssue(issues, parentPath, 'command-depth', 'Prefix commands support at most 32 levels.')
    return
  }
  const names = new Map<string, string>()
  for (const command of commands) {
    const path = [...parentPath, command.name]
    if (definitions.has(command)) {
      addIssue(
        issues,
        path,
        'reused-definition',
        'A prefix command definition can appear only once in one registry.'
      )
      continue
    }
    definitions.add(command)
    validateCommandToken(command.name, path, issues, 'name')
    for (const token of [command.name, ...(command.aliases ?? [])]) {
      validateCommandToken(token, path, issues, 'alias')
      const normalized = token.toLocaleLowerCase()
      const existing = names.get(normalized)
      if (existing !== undefined) {
        addIssue(
          issues,
          path,
          'duplicate-command-name',
          `Command name or alias "${token}" conflicts with "${existing}".`
        )
      } else {
        names.set(normalized, command.name)
      }
    }
    const executable = getPrefixCommandExecutor(command) !== undefined
    const subcommands = command.subcommands ?? []
    if (!executable && subcommands.length === 0) {
      addIssue(
        issues,
        path,
        'missing-execute',
        'A prefix command must define execute() or contain subcommands.'
      )
    }
    try {
      compilePrefixOptionSchema(command.options ?? '', parsers)
    } catch (error) {
      addIssue(
        issues,
        path,
        'invalid-options-schema',
        error instanceof Error ? error.message : String(error)
      )
    }
    validateFlags(command.flags ?? {}, parsers, path, issues)
    if (subcommands.length > 0) {
      validateSiblingCommands(subcommands, path, parsers, issues, definitions, depth + 1)
    }
  }
}

function validateFlags<TApp>(
  flags: PrefixFlagRecord,
  parsers: PrefixParserRecord<TApp>,
  path: readonly string[],
  issues: PrefixCommandValidationIssue[]
): void {
  const names = new Map<string, string>()
  for (const [name, definition] of Object.entries(flags)) {
    const flagPath = [...path, `--${name}`]
    for (const token of [name, ...(definition.aliases ?? [])]) {
      if (!/^[A-Za-z][\w-]*$/u.test(token)) {
        addIssue(issues, flagPath, 'invalid-flag-name', `Invalid flag name or alias "${token}".`)
      }
      const normalized = token.toLocaleLowerCase()
      const existing = names.get(normalized)
      if (existing !== undefined) {
        addIssue(
          issues,
          flagPath,
          'duplicate-flag-name',
          `Flag name or alias "${token}" conflicts with "${existing}".`
        )
      } else {
        names.set(normalized, name)
      }
    }
    if ('parser' in definition) {
      const parser = parsers[definition.parser]
      if (parser === undefined) {
        addIssue(
          issues,
          flagPath,
          'unknown-flag-parser',
          `Unknown prefix flag parser "${definition.parser}".`
        )
      } else if (parser.consumption !== 'token') {
        addIssue(
          issues,
          flagPath,
          'rest-flag-parser',
          `Flag "${name}" cannot use a rest-consuming parser.`
        )
      }
    }
  }
}

function buildRuntimeNode<TApp>(config: {
  ancestors: readonly RuntimePrefixNode<TApp>[]
  byDefinition: WeakMap<object, RuntimePrefixNode<TApp>>
  byPath: Map<string, RuntimePrefixNode<TApp>>
  command: PrefixCommandDefinitionBase<TApp>
  options: PrefixCommandRegistryOptions<TApp>
  parentPath: readonly string[]
  parsers: PrefixParserRecord<TApp>
  runtimeByPublic: WeakMap<PrefixCommandTreeNode<TApp>, RuntimePrefixNode<TApp>>
  seenDefinitions: WeakSet<object>
}): RuntimePrefixNode<TApp> {
  if (config.seenDefinitions.has(config.command)) {
    throw new Error('Prefix command definitions must not be reused within a registry.')
  }
  config.seenDefinitions.add(config.command)
  const path = [...config.parentPath, config.command.name]
  const publicNode: PrefixCommandTreeNode<TApp> = {
    aliases: Object.freeze([...(config.command.aliases ?? [])]),
    children: [],
    definition: config.command,
    description: config.command.description,
    executable: getPrefixCommandExecutor(config.command) !== undefined,
    name: config.command.name,
    path: Object.freeze(path)
  }
  const runtime = {
    ancestors: config.ancestors,
    childrenByName: new Map<string, RuntimePrefixNode<TApp>>(),
    flags: compileFlags(config.command.flags ?? {}, config.parsers),
    flagsByName: new Map<string, CompiledPrefixFlag>(),
    options: Object.freeze(compilePrefixOptionSchema(config.command.options ?? '', config.parsers)),
    public: publicNode
  } as RuntimePrefixNode<TApp>
  const children = (config.command.subcommands ?? []).map((child) =>
    buildRuntimeNode({
      ...config,
      ancestors: [...config.ancestors, runtime],
      command: child,
      parentPath: path
    })
  )
  const childrenByName = createNameMap(children, config.options.caseSensitive)
  const flagsByName = createFlagMap(runtime.flags, false)
  ;(runtime as { childrenByName: ReadonlyMap<string, RuntimePrefixNode<TApp>> }).childrenByName =
    childrenByName
  ;(runtime as { flagsByName: ReadonlyMap<string, CompiledPrefixFlag> }).flagsByName = flagsByName
  ;(publicNode as { children: readonly PrefixCommandTreeNode<TApp>[] }).children = Object.freeze(
    children.map((child) => child.public)
  )
  Object.freeze(publicNode)
  Object.freeze(runtime)
  config.byDefinition.set(config.command, runtime)
  config.byPath.set(pathKey(path), runtime)
  config.runtimeByPublic.set(publicNode, runtime)
  return runtime
}

function compileFlags<TApp>(
  flags: PrefixFlagRecord,
  parsers: PrefixParserRecord<TApp>
): readonly CompiledPrefixFlag[] {
  return Object.freeze(
    Object.entries(flags).map(([name, definition]) =>
      Object.freeze({
        definition,
        name,
        parser:
          'parser' in definition
            ? (parsers[definition.parser] as PrefixOptionParser<unknown, unknown, 'token'>)
            : undefined
      })
    )
  )
}

function createNameMap<TApp>(
  nodes: readonly RuntimePrefixNode<TApp>[],
  caseSensitive: boolean | undefined
): ReadonlyMap<string, RuntimePrefixNode<TApp>> {
  const result = new Map<string, RuntimePrefixNode<TApp>>()
  for (const node of nodes) {
    for (const name of [node.public.name, ...node.public.aliases]) {
      result.set(normalizeName(name, caseSensitive), node)
    }
  }
  return result
}

function createFlagMap(
  flags: readonly CompiledPrefixFlag[],
  caseSensitive: boolean | undefined
): ReadonlyMap<string, CompiledPrefixFlag> {
  const result = new Map<string, CompiledPrefixFlag>()
  for (const flag of flags) {
    for (const name of [flag.name, ...(flag.definition.aliases ?? [])]) {
      result.set(normalizeName(name, caseSensitive), flag)
    }
  }
  return result
}

async function parsePrefixValues<TApp>(config: {
  app: TApp
  message: Message
  node: RuntimePrefixNode<TApp>
  parsers: PrefixParserRecord<TApp>
  tokens: readonly PrefixToken[]
}): Promise<ParsedPrefixValues> {
  const { flags, positional } = await parseFlags(config)
  if (config.node.options.length === 0 && positional.length === 0) {
    return { flags, options: emptyParsedValues }
  }
  // tasky: Parsed names are user-authored, so result bags must never inherit Object.prototype.
  const options = Object.create(null) as Record<string, unknown>
  let index = 0
  for (const option of config.node.options) {
    const parser = config.parsers[option.parser]!
    if (parser.consumption === 'rest') {
      const remaining = positional.slice(index)
      if (remaining.length === 0) {
        if (!option.optional) {
          throw missingOption(config.node.public.path, option.name)
        }
        continue
      }
      options[option.name] = await runParser({
        ...config,
        optionName: option.name,
        parser,
        tokens: remaining
      })
      index = positional.length
      continue
    }
    const token = positional[index]
    if (token === undefined) {
      if (!option.optional) {
        throw missingOption(config.node.public.path, option.name)
      }
      continue
    }
    options[option.name] = await runParser({
      ...config,
      optionName: option.name,
      parser,
      tokens: [token]
    })
    index += 1
  }
  if (index < positional.length) {
    throw new PrefixCommandParseError({
      code: 'too-many-options',
      input: positional
        .slice(index)
        .map((token) => token.value)
        .join(' '),
      message: `Too many positional options for "${config.node.public.path.join(' ')}".`,
      path: config.node.public.path
    })
  }
  return { flags, options: Object.freeze(options) }
}

async function parseFlags<TApp>(config: {
  app: TApp
  message: Message
  node: RuntimePrefixNode<TApp>
  tokens: readonly PrefixToken[]
}): Promise<{
  flags: Readonly<Record<string, unknown>>
  positional: readonly PrefixToken[]
}> {
  if (config.node.flags.length === 0 && config.tokens.length === 0) {
    // tasky: The no-argument command path is common enough to avoid allocating empty bags and arrays.
    return { flags: emptyParsedValues, positional: config.tokens }
  }
  const flags = Object.create(null) as Record<string, unknown>
  const positional: PrefixToken[] = []
  const seen = new Set<string>()
  let flagsEnabled = true

  for (const flag of config.node.flags) {
    if ('kind' in flag.definition) {
      flags[flag.name] = false
    } else if (flag.definition.multiple === true) {
      flags[flag.name] = []
    }
  }

  for (let index = 0; index < config.tokens.length; index += 1) {
    const token = config.tokens[index]!
    if (flagsEnabled && token.value === '--') {
      flagsEnabled = false
      continue
    }
    const parsed = flagsEnabled ? parseFlagToken(token.value) : undefined
    if (parsed === undefined) {
      positional.push(token)
      continue
    }
    const lookupName = normalizeName(parsed.name, false)
    const flag = config.node.flagsByName.get(lookupName)
    if (flag === undefined) {
      throw new PrefixCommandParseError({
        code: 'unknown-flag',
        input: token.value,
        message: `Unknown flag "${token.value}".`,
        option: parsed.name,
        path: config.node.public.path
      })
    }
    if ('kind' in flag.definition) {
      if (parsed.inlineValue !== undefined) {
        throw new PrefixCommandParseError({
          code: 'unexpected-flag-value',
          input: token.value,
          message: `Boolean flag "--${flag.name}" does not accept a value.`,
          option: flag.name,
          path: config.node.public.path
        })
      }
      flags[flag.name] = !parsed.negated
      seen.add(flag.name)
      continue
    }
    if (parsed.negated) {
      throw new PrefixCommandParseError({
        code: 'invalid-flag',
        input: token.value,
        message: `Value flag "--${flag.name}" cannot be negated.`,
        option: flag.name,
        path: config.node.public.path
      })
    }
    const valueToken =
      parsed.inlineValue === undefined
        ? config.tokens[index + 1]
        : { ...token, raw: parsed.inlineValue, value: parsed.inlineValue }
    if (valueToken === undefined) {
      throw new PrefixCommandParseError({
        code: 'missing-flag-value',
        input: token.value,
        message: `Flag "--${flag.name}" requires a value.`,
        option: flag.name,
        path: config.node.public.path
      })
    }
    if (parsed.inlineValue === undefined) {
      index += 1
    }
    if (seen.has(flag.name) && flag.definition.multiple !== true) {
      throw new PrefixCommandParseError({
        code: 'invalid-flag',
        input: token.value,
        message: `Flag "--${flag.name}" cannot be repeated.`,
        option: flag.name,
        path: config.node.public.path
      })
    }
    const value = await runParser({
      ...config,
      optionName: flag.name,
      parser: flag.parser!,
      tokens: [valueToken]
    })
    if (flag.definition.multiple === true) {
      ;(flags[flag.name] as unknown[]).push(value)
    } else {
      flags[flag.name] = value
    }
    seen.add(flag.name)
  }

  for (const flag of config.node.flags) {
    if (
      'required' in flag.definition &&
      flag.definition.required === true &&
      !seen.has(flag.name)
    ) {
      throw new PrefixCommandParseError({
        code: 'missing-flag-value',
        message: `Required flag "--${flag.name}" was not provided.`,
        option: flag.name,
        path: config.node.public.path
      })
    }
    if (Array.isArray(flags[flag.name])) {
      Object.freeze(flags[flag.name])
    }
  }
  return { flags: Object.freeze(flags), positional }
}

function parseFlagToken(
  value: string
): { inlineValue?: string; name: string; negated: boolean } | undefined {
  if (value.charCodeAt(0) !== 45) {
    return undefined
  }
  if (value.charCodeAt(1) === 45 && value.length > 2) {
    const equal = value.indexOf('=')
    const rawName = value.slice(2, equal === -1 ? undefined : equal)
    const negated = rawName.startsWith('no-')
    return {
      inlineValue: equal === -1 ? undefined : value.slice(equal + 1),
      name: negated ? rawName.slice(3) : rawName,
      negated
    }
  }
  const shortCode = value.charCodeAt(1)
  // tasky: A single negative digit is positional; valid short aliases start with ASCII letters.
  if (
    value.length === 2 &&
    ((shortCode >= 65 && shortCode <= 90) || (shortCode >= 97 && shortCode <= 122))
  ) {
    return { name: value.slice(1), negated: false }
  }
  if (value.length >= 3 && value.charCodeAt(2) === 61) {
    return { inlineValue: value.slice(3), name: value[1]!, negated: false }
  }
  return undefined
}

async function runParser<TApp>(config: {
  app: TApp
  message: Message
  node: RuntimePrefixNode<TApp>
  optionName: string
  parser: PrefixOptionParser<unknown, unknown, PrefixParserConsumption>
  tokens: readonly PrefixToken[]
}): Promise<unknown> {
  const onlyToken = config.tokens.length === 1 ? config.tokens[0] : undefined
  const values =
    onlyToken === undefined ? config.tokens.map((token) => token.value) : [onlyToken.value]
  const context: PrefixParserContext<TApp> = {
    app: config.app,
    commandPath: config.node.public.path,
    fail: createPrefixParserFail(),
    message: config.message,
    optionName: config.optionName,
    raw: onlyToken?.raw ?? config.tokens.map((token) => token.raw).join(' '),
    value: onlyToken?.value ?? values.join(' '),
    values
  }
  try {
    return await config.parser.parse(context)
  } catch (error) {
    if (error instanceof PrefixParserFailure) {
      throw new PrefixCommandParseError({
        code: 'parser-failed',
        input: context.raw,
        message: error.message,
        option: config.optionName,
        path: config.node.public.path
      })
    }
    throw error
  }
}

function validateInvokedValues<TApp>(
  node: RuntimePrefixNode<TApp>,
  values: {
    flags: Readonly<Record<string, unknown>>
    options: Readonly<Record<string, unknown>>
  }
): void {
  const optionNames = new Set(node.options.map((option) => option.name))
  const flagNames = new Set(node.flags.map((flag) => flag.name))
  for (const option of node.options) {
    if (!option.optional && values.options[option.name] === undefined) {
      throw new Error(`Missing required invoked option "${option.name}".`)
    }
  }
  for (const name of Object.keys(values.options)) {
    if (!optionNames.has(name)) {
      throw new Error(`Unknown invoked option "${name}".`)
    }
  }
  for (const flag of node.flags) {
    if ('kind' in flag.definition && typeof values.flags[flag.name] !== 'boolean') {
      throw new Error(`Invoked boolean flag "${flag.name}" must be provided as true or false.`)
    }
    if (
      'required' in flag.definition &&
      flag.definition.required === true &&
      values.flags[flag.name] === undefined
    ) {
      throw new Error(`Missing required invoked flag "${flag.name}".`)
    }
  }
  for (const name of Object.keys(values.flags)) {
    if (!flagNames.has(name)) {
      throw new Error(`Unknown invoked flag "${name}".`)
    }
  }
}

function missingOption(path: readonly string[], option: string): PrefixCommandParseError {
  return new PrefixCommandParseError({
    code: 'missing-option',
    message: `Missing required option "${option}".`,
    option,
    path
  })
}

async function resolveMessagePrefix<TApp>(
  resolver: PrefixResolver<TApp>,
  app: TApp,
  message: Message
): Promise<string | undefined> {
  const resolved = typeof resolver === 'function' ? await resolver({ app, message }) : resolver
  const prefixes = typeof resolved === 'string' ? [resolved] : (resolved ?? [])
  let matched: string | undefined
  // tasky: Longest-prefix selection is a linear scan to avoid filter, copy, and sort allocations.
  for (const prefix of prefixes) {
    if (
      prefix.length > 0 &&
      prefix.length > (matched?.length ?? 0) &&
      message.content.startsWith(prefix)
    ) {
      matched = prefix
    }
  }
  return matched
}

function freezePrefixDefinition<TApp>(definition: PrefixCommandDefinitionBase<TApp>): void {
  if (definition.subcommands !== undefined) {
    for (const child of definition.subcommands) {
      freezePrefixDefinition(child)
    }
    Object.freeze(definition.subcommands)
  }
  if (definition.aliases !== undefined) {
    Object.freeze(definition.aliases)
  }
  if (definition.flags !== undefined) {
    for (const flag of Object.values(definition.flags)) {
      if (flag.aliases !== undefined) {
        Object.freeze(flag.aliases)
      }
      Object.freeze(flag)
    }
    Object.freeze(definition.flags)
  }
  Object.freeze(definition)
}

function validateCommandToken(
  token: string,
  path: readonly string[],
  issues: PrefixCommandValidationIssue[],
  kind: 'alias' | 'name'
): void {
  if (token.length === 0 || /\s/u.test(token)) {
    addIssue(
      issues,
      path,
      `invalid-command-${kind}`,
      `Prefix command ${kind}s must be non-empty tokens without whitespace.`
    )
  }
}

function addIssue(
  issues: PrefixCommandValidationIssue[],
  path: readonly string[],
  code: string,
  message: string
): void {
  issues.push({ code, message, path })
}

function normalizeName(value: string, caseSensitive: boolean | undefined): string {
  return caseSensitive === true ? value : value.toLowerCase()
}

function pathKey(path: readonly string[]): string {
  return path.join('\u0000')
}

function freezeRecord(
  values: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const result = Object.create(null) as Record<string, unknown>
  Object.assign(result, values)
  return Object.freeze(result)
}
