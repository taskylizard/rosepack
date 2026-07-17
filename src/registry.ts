import {
  ApplicationCommandOptionTypes,
  ApplicationCommandTypes,
  CommandInteraction
} from 'oceanic.js'
import type {
  AnyInteractionGateway,
  ApplicationCommandOptions,
  Client,
  CreateApplicationCommandOptions,
  InteractionOptions
} from 'oceanic.js'
import { SlashCommandContext } from './context.ts'
import {
  createSlashCommandDefinition,
  createSubcommandDefinition,
  type SlashCommandDefinition,
  type SlashCommandInput,
  type SlashCommandInputResult,
  type SlashCommandOptionChoice,
  type SlashCommandOptionKind,
  type SlashCommandOptionValue,
  type SlashCommandTreeDefinition,
  type SlashCommandTreeNode,
  type SlashCommandValueOptionDefinition,
  type SlashCommandValueOptionRecord,
  type SlashRootCommandDefinitionBase,
  type SlashSubcommandDefinition,
  type SlashSubcommandDefinitionBase,
  type SlashSubcommandGroupDefinition,
  type SlashSubcommandInput,
  type SlashSubcommandRecord
} from './commands.ts'
import {
  getSlashCommandExecutor,
  getSlashSubcommandExecutor,
  type SlashCommandExecutor
} from './executors.ts'
import { invocationTrail, invokeRegistryCommand } from './internal.ts'
import { integrationTypeByInstallation, interactionContextTypeByName } from './metadata.ts'
import { createPrefixCommands, type CreatePrefixCommands } from './prefix-registry.ts'
import { createPrefixParser, type DefinePrefixParser } from './prefix-parsers.ts'
import { CommandTreeValidationError, lintSlashCommandTree } from './validation.ts'

/** Configuration shared by registries created from one rosepack instance. */
export interface RosepackOptions<TApp> {
  /** Called when Discord sends a chat-input command that is not present in the registry. */
  onUnknownCommand?(context: {
    app: TApp
    interaction: CommandInteraction
    registry: SlashCommandRegistry<TApp>
  }): void | Promise<void>
}

interface RuntimeSlashOption {
  readonly choices?: ReadonlySet<SlashCommandOptionValue>
  readonly definition: SlashCommandValueOptionDefinition
  readonly discordType: ApplicationCommandOptionTypes
  readonly name: string
}

interface RuntimeSlashNode<TApp> {
  readonly childrenByName: ReadonlyMap<string, RuntimeSlashNode<TApp>>
  readonly executor?: SlashCommandExecutor
  readonly optionsByName: ReadonlyMap<string, RuntimeSlashOption>
  readonly public: SlashCommandTreeNode<TApp>
  readonly requiredOptions: readonly RuntimeSlashOption[]
}

const emptySlashOptionValues = Object.freeze(Object.create(null)) as Readonly<
  Record<string, SlashCommandOptionValue | undefined>
>
const emptyRuntimeSlashChildren = new Map<string, RuntimeSlashNode<never>>()
const emptyRuntimeSlashOptions = {
  optionsByName: new Map<string, RuntimeSlashOption>(),
  requiredOptions: Object.freeze([]) as readonly RuntimeSlashOption[]
} as const

/** A validated, frozen, and searchable collection of slash commands. */
export class SlashCommandRegistry<TApp> {
  /** Frozen Discord registration payloads in the same order as the root commands. */
  readonly payload: readonly CreateApplicationCommandOptions[]
  /** Frozen command-tree roots available for inspection and routing. */
  readonly tree: readonly SlashCommandTreeNode<TApp>[]
  readonly #byDefinition: WeakMap<object, RuntimeSlashNode<TApp>>
  readonly #byPath: ReadonlyMap<string, SlashCommandTreeNode<TApp>>
  readonly #options: RosepackOptions<TApp>
  readonly #rootsByName: ReadonlyMap<string, RuntimeSlashNode<TApp>>
  readonly #runtimeByPublic: WeakMap<SlashCommandTreeNode<TApp>, RuntimeSlashNode<TApp>>

  constructor(config: {
    byDefinition: WeakMap<object, RuntimeSlashNode<TApp>>
    byPath: ReadonlyMap<string, SlashCommandTreeNode<TApp>>
    options: RosepackOptions<TApp>
    payload: readonly CreateApplicationCommandOptions[]
    rootsByName: ReadonlyMap<string, RuntimeSlashNode<TApp>>
    runtimeByPublic: WeakMap<SlashCommandTreeNode<TApp>, RuntimeSlashNode<TApp>>
    tree: readonly SlashCommandTreeNode<TApp>[]
  }) {
    this.#byDefinition = config.byDefinition
    this.#byPath = config.byPath
    this.#options = config.options
    this.#rootsByName = config.rootsByName
    this.#runtimeByPublic = config.runtimeByPublic
    this.payload = config.payload
    this.tree = config.tree
    Object.freeze(this)
  }

  /** Finds a root node by command name or any node by its original definition object. */
  get(name: string): SlashCommandTreeNode<TApp> | undefined
  get(definition: SlashCommandTreeDefinition<TApp>): SlashCommandTreeNode<TApp> | undefined
  get(selector: SlashCommandTreeDefinition<TApp> | string): SlashCommandTreeNode<TApp> | undefined {
    return typeof selector === 'string'
      ? this.#rootsByName.get(selector)?.public
      : this.#byDefinition.get(selector)?.public
  }

  /** Finds a node by path, such as `/memory server show` or an array of segments. */
  resolve(path: readonly string[] | string): SlashCommandTreeNode<TApp> | undefined {
    const key = typeof path === 'string' ? commandStringPathKey(path) : commandPathKey(path)
    return this.#byPath.get(key)
  }

  async [invokeRegistryCommand](
    source: SlashCommandContext<TApp, SlashCommandValueOptionRecord>,
    target:
      | SlashCommandDefinition<TApp, SlashCommandValueOptionRecord>
      | SlashCommandTreeNode<TApp>
      | SlashSubcommandDefinition<TApp, SlashCommandValueOptionRecord>,
    options: Readonly<Record<string, SlashCommandOptionValue | undefined>>
  ): Promise<void> {
    const node =
      'definition' in target ? this.#runtimeByPublic.get(target) : this.#byDefinition.get(target)
    if (node === undefined) {
      throw new Error('Cannot invoke a command definition that is not in this registry.')
    }
    if (!node.public.executable) {
      throw new Error(`Command path "${node.public.path.join(' ')}" is not executable.`)
    }
    if (source[invocationTrail].includes(node.public.definition)) {
      throw new Error(`Recursive command invocation detected at "${node.public.path.join(' ')}".`)
    }
    const validatedOptions = validateResolvedOptionValues(node, options)
    const root = this.#rootsByName.get(node.public.path[0]!)
    if (root === undefined) {
      throw new Error(`Command root "${node.public.path[0]}" is missing from the registry.`)
    }
    await this.#execute({
      app: source.app,
      interaction: source.interaction,
      invocationTrail: [...source[invocationTrail], node.public.definition],
      node,
      options: validatedOptions,
      root
    })
  }

  /**
   * Routes a chat-input interaction to its executable command node.
   *
   * Non-command interactions are ignored. Unknown chat-input commands are
   * forwarded to the optional `onUnknownCommand` callback.
   */
  async dispatch(config: { app: TApp; interaction: AnyInteractionGateway }): Promise<void> {
    const { app, interaction } = config
    if (!(interaction instanceof CommandInteraction) || !interaction.isChatInputCommand()) {
      return
    }
    const root = this.#rootsByName.get(interaction.data.name)
    if (root === undefined) {
      await this.#options.onUnknownCommand?.({ app, interaction, registry: this })
      return
    }
    const { node, rawOptions } = resolveInteractionNode(root, interaction.data.options.raw)
    const options = parseSlashValueOptionValues(node, rawOptions)
    await this.#execute({
      app,
      interaction,
      invocationTrail: [node.public.definition],
      node,
      options,
      root
    })
  }

  /** Replaces the application's global commands with this registry's payload. */
  async registerGlobal(config: {
    applicationID: string
    client: Client
  }): Promise<Awaited<ReturnType<Client['rest']['applications']['bulkEditGlobalCommands']>>> {
    return config.client.rest.applications.bulkEditGlobalCommands(config.applicationID, [
      ...this.payload
    ])
  }

  async #execute(config: {
    app: TApp
    interaction: CommandInteraction
    invocationTrail: readonly SlashCommandTreeDefinition<TApp>[]
    node: RuntimeSlashNode<TApp>
    options: Record<string, SlashCommandOptionValue | undefined>
    root: RuntimeSlashNode<TApp>
  }): Promise<void> {
    const context = new SlashCommandContext({
      app: config.app,
      command: config.root.public,
      interaction: config.interaction,
      invocationTrail: config.invocationTrail,
      node: config.node.public,
      options: config.options,
      registry: this
    })
    const rootDefinition = config.root.public.definition as SlashRootCommandDefinitionBase<TApp>
    const executor = config.node.executor
    if (executor === undefined) {
      throw new Error(`Command path "${config.node.public.path.join(' ')}" has no executor.`)
    }

    try {
      await rootDefinition.beforeExecute?.(context)
      await executor(context)
    } catch (error) {
      if (rootDefinition.onError === undefined) {
        throw error
      }
      await rootDefinition.onError(context, error)
    }
  }
}

/** A slash-subcommand definition helper bound to an application's context type. */
export interface DefineSlashSub<TApp> {
  <const TOptions extends SlashCommandValueOptionRecord>(
    definition: SlashSubcommandInput<TApp, TOptions> & { options: TOptions }
  ): SlashSubcommandDefinition<TApp, TOptions>
  (
    definition: SlashSubcommandInput<TApp, {}> & { options?: never }
  ): SlashSubcommandDefinition<TApp, {}>
}

/** A root slash-command definition helper bound to an application's context type. */
export interface SlashBuilder<TApp> {
  <
    const TOptions extends SlashCommandValueOptionRecord = {},
    const TSubcommands extends Record<string, unknown> | undefined = undefined
  >(
    definition: SlashCommandInput<TApp, TOptions, TSubcommands>
  ): SlashCommandInputResult<TApp, TOptions, TSubcommands>
}

/** The helpers and registry factory produced by `createRosepack`. */
export interface RosepackInstance<TApp> {
  /** Creates a typed prefix-command scope with built-in and optional custom parsers. */
  createPrefixCommands: CreatePrefixCommands<TApp>
  /** Creates and freezes a validated command registry. */
  createRegistry(
    commands: readonly SlashRootCommandDefinitionBase<TApp>[]
  ): SlashCommandRegistry<TApp>
  /** Defines a root slash command while preserving local option inference. */
  slash: SlashBuilder<TApp>
  /** Defines an executable slash subcommand while preserving local option inference. */
  slashSub: DefineSlashSub<TApp>
  /** Defines a custom prefix parser while preserving its runtime output type. */
  prefixParser: DefinePrefixParser<TApp>
}

/**
 * Creates command helpers bound to an application's service/context type.
 *
 * rosepack stores no application state in the returned object. The generic is
 * used to type `context.app` whenever a registry dispatches an interaction.
 */
export function createRosepack<TApp>(options: RosepackOptions<TApp> = {}): RosepackInstance<TApp> {
  return {
    createPrefixCommands: createPrefixCommands as CreatePrefixCommands<TApp>,
    createRegistry: (commands) => buildSlashCommandTree(commands, options),
    prefixParser: createPrefixParser as DefinePrefixParser<TApp>,
    slash: createSlashCommandDefinition as SlashBuilder<TApp>,
    slashSub: createSubcommandDefinition as DefineSlashSub<TApp>
  }
}

/**
 * Validates definitions and builds a frozen registry.
 * @throws {CommandTreeValidationError} when any definition violates rosepack or Discord rules.
 */
export function buildSlashCommandTree<TApp>(
  commands: readonly SlashRootCommandDefinitionBase<TApp>[],
  options: RosepackOptions<TApp> = {}
): SlashCommandRegistry<TApp> {
  const issues = lintSlashCommandTree(commands)
  if (issues.length > 0) {
    throw new CommandTreeValidationError(issues)
  }

  const byDefinition = new WeakMap<object, RuntimeSlashNode<TApp>>()
  const byPath = new Map<string, SlashCommandTreeNode<TApp>>()
  const runtimeByPublic = new WeakMap<SlashCommandTreeNode<TApp>, RuntimeSlashNode<TApp>>()
  const roots = commands.map((command) =>
    buildRootNode(command, byDefinition, byPath, runtimeByPublic)
  )
  const rootsByName = new Map(roots.map((root) => [root.public.name, root] as const))
  const payload = deepFreeze(commands.map(commandToDiscordUnchecked))

  for (const command of commands) {
    freezeCommandDefinition(command)
  }

  return new SlashCommandRegistry({
    byDefinition,
    byPath,
    options,
    payload,
    rootsByName,
    runtimeByPublic,
    tree: Object.freeze(roots.map((root) => root.public))
  })
}

/** Validates one command and converts it to an Oceanic registration payload. */
export function slashCommandToDiscord(
  command: SlashRootCommandDefinitionBase<unknown>
): CreateApplicationCommandOptions {
  const issues = lintSlashCommandTree([command])
  if (issues.length > 0) {
    throw new CommandTreeValidationError(issues)
  }
  const payload = deepFreeze(commandToDiscordUnchecked(command))
  freezeCommandDefinition(command)
  return payload
}

function buildRootNode<TApp>(
  command: SlashRootCommandDefinitionBase<TApp>,
  byDefinition: WeakMap<object, RuntimeSlashNode<TApp>>,
  byPath: Map<string, SlashCommandTreeNode<TApp>>,
  runtimeByPublic: WeakMap<SlashCommandTreeNode<TApp>, RuntimeSlashNode<TApp>>
): RuntimeSlashNode<TApp> {
  const path = [command.name]
  const children =
    command.subcommands === undefined
      ? []
      : Object.entries(command.subcommands).map(([name, definition]) =>
          buildSubcommandNode(name, definition, path, byDefinition, byPath, runtimeByPublic)
        )
  const publicNode = freezeTreeNode({
    children: children.map((child) => child.public),
    definition: command,
    description: command.description,
    executable: command.subcommands === undefined,
    name: command.name,
    path
  })
  const runtime = createRuntimeSlashNode(publicNode, children)
  byDefinition.set(command, runtime)
  byPath.set(commandPathKey(path), publicNode)
  runtimeByPublic.set(publicNode, runtime)
  return runtime
}

function buildSubcommandNode<TApp>(
  name: string,
  definition: SlashSubcommandDefinitionBase<TApp> | SlashSubcommandGroupDefinition<TApp>,
  parentPath: readonly string[],
  byDefinition: WeakMap<object, RuntimeSlashNode<TApp>>,
  byPath: Map<string, SlashCommandTreeNode<TApp>>,
  runtimeByPublic: WeakMap<SlashCommandTreeNode<TApp>, RuntimeSlashNode<TApp>>
): RuntimeSlashNode<TApp> {
  const path = [...parentPath, name]
  const children =
    'subcommands' in definition
      ? Object.entries(definition.subcommands).map(([childName, childDefinition]) =>
          buildSubcommandNode(
            childName,
            childDefinition,
            path,
            byDefinition,
            byPath,
            runtimeByPublic
          )
        )
      : []
  const publicNode = freezeTreeNode({
    children: children.map((child) => child.public),
    definition,
    description: definition.description,
    executable: !('subcommands' in definition),
    name,
    path
  })
  const runtime = createRuntimeSlashNode(publicNode, children)
  byDefinition.set(definition, runtime)
  byPath.set(commandPathKey(path), publicNode)
  runtimeByPublic.set(publicNode, runtime)
  return runtime
}

function createRuntimeSlashNode<TApp>(
  publicNode: SlashCommandTreeNode<TApp>,
  children: readonly RuntimeSlashNode<TApp>[]
): RuntimeSlashNode<TApp> {
  const { optionsByName, requiredOptions } = compileRuntimeSlashOptions(
    commandNodeOptions(publicNode)
  )
  return Object.freeze({
    childrenByName:
      children.length === 0
        ? emptyRuntimeSlashChildren
        : new Map(children.map((child) => [child.public.name, child] as const)),
    executor: commandNodeExecutor(publicNode),
    optionsByName,
    public: publicNode,
    requiredOptions
  })
}

function compileRuntimeSlashOptions(
  definitions: SlashCommandValueOptionRecord | undefined
): Pick<RuntimeSlashNode<unknown>, 'optionsByName' | 'requiredOptions'> {
  if (definitions === undefined) {
    return emptyRuntimeSlashOptions
  }
  const optionsByName = new Map<string, RuntimeSlashOption>()
  const requiredOptions: RuntimeSlashOption[] = []
  for (const name of Object.keys(definitions)) {
    const definition = definitions[name]!
    const option = Object.freeze({
      choices:
        definition.choices === undefined
          ? undefined
          : new Set(definition.choices.map((choice) => choice.value)),
      definition,
      discordType: optionKindToDiscordType(definition.kind),
      name
    })
    optionsByName.set(name, option)
    if (definition.required === true) {
      requiredOptions.push(option)
    }
  }
  return { optionsByName, requiredOptions: Object.freeze(requiredOptions) }
}

function freezeTreeNode<TApp>(node: SlashCommandTreeNode<TApp>): SlashCommandTreeNode<TApp> {
  return Object.freeze({
    ...node,
    children: Object.freeze([...node.children]),
    path: Object.freeze([...node.path])
  })
}

function freezeCommandDefinition<TApp>(definition: SlashRootCommandDefinitionBase<TApp>): void {
  deepFreeze(definition)
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  for (const child of Object.values(value)) {
    deepFreeze(child)
  }
  return Object.freeze(value)
}

function resolveInteractionNode<TApp>(
  root: RuntimeSlashNode<TApp>,
  options: InteractionOptions[]
): { node: RuntimeSlashNode<TApp>; rawOptions: InteractionOptions[] } {
  if (root.public.executable) {
    return { node: root, rawOptions: options }
  }
  if (options.length !== 1) {
    throw new Error(`Expected exactly one subcommand for "${root.public.name}".`)
  }
  const selected = options[0]!
  const child = root.childrenByName.get(selected.name)
  if (child === undefined) {
    throw new Error(`Unknown command path "${[...root.public.path, selected.name].join(' ')}".`)
  }
  if (selected.type === ApplicationCommandOptionTypes.SUB_COMMAND) {
    if (!child.public.executable)
      throw new Error(`Command path "${child.public.path.join(' ')}" is not executable.`)
    return { node: child, rawOptions: selected.options ?? [] }
  }
  if (
    selected.type !== ApplicationCommandOptionTypes.SUB_COMMAND_GROUP ||
    child.public.executable
  ) {
    throw new Error(`Command option "${selected.name}" does not match the registered tree.`)
  }
  if (selected.options?.length !== 1) {
    throw new Error(`Expected exactly one subcommand inside "${child.public.path.join(' ')}".`)
  }
  const nested = selected.options[0]!
  const leaf = child.childrenByName.get(nested.name)
  if (
    nested.type !== ApplicationCommandOptionTypes.SUB_COMMAND ||
    leaf === undefined ||
    !leaf.public.executable
  ) {
    throw new Error(`Unknown command path "${[...child.public.path, nested.name].join(' ')}".`)
  }
  return { node: leaf, rawOptions: nested.options ?? [] }
}

function commandNodeExecutor<TApp>(
  node: SlashCommandTreeNode<TApp>
): SlashCommandExecutor | undefined {
  return getSlashCommandExecutor(node.definition) ?? getSlashSubcommandExecutor(node.definition)
}

function commandNodeOptions<TApp>(
  node: SlashCommandTreeNode<TApp>
): SlashCommandValueOptionRecord | undefined {
  return 'options' in node.definition ? node.definition.options : undefined
}

function parseSlashValueOptionValues(
  runtime: RuntimeSlashNode<unknown>,
  options: InteractionOptions[]
): Record<string, SlashCommandOptionValue | undefined> {
  if (options.length > 25) {
    throw new Error(`Too many options for "${runtime.public.path.join(' ')}".`)
  }
  if (options.length === 0 && runtime.requiredOptions.length === 0) {
    return emptySlashOptionValues
  }
  // tasky: Option names originate outside the process, so the result bag has no prototype.
  const values = Object.create(null) as Record<string, SlashCommandOptionValue | undefined>
  for (const option of options) {
    const runtimeOption = runtime.optionsByName.get(option.name)
    if (runtimeOption === undefined || !('value' in option) || Object.hasOwn(values, option.name)) {
      throw new Error(`Unexpected option "${option.name}" for "${runtime.public.path.join(' ')}".`)
    }
    if (option.type !== runtimeOption.discordType) {
      throw new Error(`Option "${option.name}" has an unexpected type.`)
    }
    validateSlashOptionValue(runtimeOption, option.value, runtime.public.path)
    values[option.name] = option.value
  }
  for (const required of runtime.requiredOptions) {
    if (!Object.hasOwn(values, required.name)) {
      throw new Error(
        `Missing required option "${required.name}" for "${runtime.public.path.join(' ')}".`
      )
    }
  }
  return Object.freeze(values)
}

function validateResolvedOptionValues(
  runtime: RuntimeSlashNode<unknown>,
  values: Readonly<Record<string, SlashCommandOptionValue | undefined>>
): Record<string, SlashCommandOptionValue | undefined> {
  if (runtime.optionsByName.size === 0 && Object.keys(values).length === 0) {
    return emptySlashOptionValues
  }
  const result = Object.create(null) as Record<string, SlashCommandOptionValue | undefined>
  for (const name of Object.keys(values)) {
    const value = values[name]
    const runtimeOption = runtime.optionsByName.get(name)
    if (runtimeOption === undefined) {
      throw new Error(`Unexpected option "${name}" for "${runtime.public.path.join(' ')}".`)
    }
    if (value !== undefined) {
      validateSlashOptionValue(runtimeOption, value, runtime.public.path)
    }
    result[name] = value
  }
  for (const required of runtime.requiredOptions) {
    if (result[required.name] === undefined) {
      throw new Error(
        `Missing required option "${required.name}" for "${runtime.public.path.join(' ')}".`
      )
    }
  }
  return Object.freeze(result)
}

function validateSlashOptionValue(
  runtimeOption: RuntimeSlashOption,
  value: SlashCommandOptionValue,
  path: readonly string[]
): void {
  const { definition, name } = runtimeOption
  const expectedType =
    definition.kind === 'boolean' ? 'boolean' : definition.kind === 'string' ? 'string' : 'number'
  if (typeof value !== expectedType) {
    throw new Error(`Option "${name}" for "${path.join(' ')}" must be a ${expectedType}.`)
  }
  if (definition.kind === 'integer' && !Number.isSafeInteger(value)) {
    throw new Error(`Option "${name}" for "${path.join(' ')}" must be a safe integer.`)
  }
  if (definition.kind === 'number' && !Number.isFinite(value)) {
    throw new Error(`Option "${name}" for "${path.join(' ')}" must be finite.`)
  }
  if (
    definition.kind === 'string' &&
    typeof value === 'string' &&
    ((definition.minLength !== undefined && value.length < definition.minLength) ||
      (definition.maxLength !== undefined && value.length > definition.maxLength))
  ) {
    throw new Error(`Option "${name}" for "${path.join(' ')}" has an invalid length.`)
  }
  if (runtimeOption.choices !== undefined && !runtimeOption.choices.has(value)) {
    throw new Error(`Option "${name}" for "${path.join(' ')}" has an unsupported value.`)
  }
}

function commandToDiscordUnchecked(
  command: SlashRootCommandDefinitionBase
): CreateApplicationCommandOptions {
  return {
    contexts: command.contexts?.map((context) => interactionContextTypeByName[context]),
    description: command.description,
    integrationTypes: command.installations?.map(
      (installation) => integrationTypeByInstallation[installation]
    ),
    name: command.name,
    options:
      command.subcommands === undefined
        ? commandValueOptionsToDiscord(command.options)
        : subcommandsToDiscord(command.subcommands),
    type: ApplicationCommandTypes.CHAT_INPUT
  }
}

function subcommandsToDiscord(definitions: SlashSubcommandRecord): ApplicationCommandOptions[] {
  return Object.entries(definitions).map(([name, definition]) => {
    if ('subcommands' in definition) {
      return {
        description: definition.description,
        name,
        options: Object.entries(definition.subcommands).map(([nestedName, nestedDefinition]) => ({
          description: nestedDefinition.description,
          name: nestedName,
          options: commandValueOptionsToDiscord(nestedDefinition.options),
          type: ApplicationCommandOptionTypes.SUB_COMMAND
        })),
        type: ApplicationCommandOptionTypes.SUB_COMMAND_GROUP
      } as ApplicationCommandOptions
    }
    return {
      description: definition.description,
      name,
      options: commandValueOptionsToDiscord(definition.options),
      type: ApplicationCommandOptionTypes.SUB_COMMAND
    } as ApplicationCommandOptions
  })
}

function commandValueOptionsToDiscord(
  options: SlashCommandValueOptionRecord | undefined
): ApplicationCommandOptions[] | undefined {
  if (options === undefined) return undefined
  const required: ApplicationCommandOptions[] = []
  const optional: ApplicationCommandOptions[] = []
  // tasky: Discord only needs a stable required-first partition; sorting all options does extra work.
  for (const name of Object.keys(options)) {
    const option = options[name]!
    ;(option.required === true ? required : optional).push(optionToDiscord(name, option))
  }
  required.push(...optional)
  return required
}

function optionToDiscord(
  name: string,
  option: SlashCommandValueOptionDefinition
): ApplicationCommandOptions {
  const payload = {
    description: option.description,
    name,
    required: option.required === true,
    type: optionKindToDiscordType(option.kind)
  } as ApplicationCommandOptions & {
    choices?: SlashCommandOptionChoice[]
    maxLength?: number
    minLength?: number
  }
  if (option.choices !== undefined) payload.choices = [...option.choices]
  if (option.kind === 'string' && option.maxLength !== undefined)
    payload.maxLength = option.maxLength
  if (option.kind === 'string' && option.minLength !== undefined)
    payload.minLength = option.minLength
  return payload
}

function commandPathKey(path: readonly string[]): string {
  // tasky: Discord slash trees stop at three segments, so avoid the generic join machinery there.
  switch (path.length) {
    case 0:
      return ''
    case 1:
      return path[0]!
    case 2:
      return `${path[0]}\u0000${path[1]}`
    case 3:
      return `${path[0]}\u0000${path[1]}\u0000${path[2]}`
    default:
      return path.join('\u0000')
  }
}

function commandStringPathKey(path: string): string {
  let index = 0
  while (isPathWhitespace(path.charCodeAt(index))) index += 1
  if (path.charCodeAt(index) === 47) index += 1

  let key = ''
  let segments = 0
  while (index < path.length) {
    while (isPathWhitespace(path.charCodeAt(index))) index += 1
    if (index >= path.length) break
    const start = index
    while (index < path.length && !isPathWhitespace(path.charCodeAt(index))) index += 1
    if (segments > 0) key += '\u0000'
    key += path.slice(start, index)
    segments += 1
  }
  return key
}

function isPathWhitespace(code: number): boolean {
  if (code === 32 || (code >= 9 && code <= 13)) return true
  return code > 127 && /\s/u.test(String.fromCharCode(code))
}

function optionKindToDiscordType(kind: SlashCommandOptionKind): ApplicationCommandOptionTypes {
  switch (kind) {
    case 'boolean':
      return ApplicationCommandOptionTypes.BOOLEAN
    case 'integer':
      return ApplicationCommandOptionTypes.INTEGER
    case 'number':
      return ApplicationCommandOptionTypes.NUMBER
    case 'string':
      return ApplicationCommandOptionTypes.STRING
  }
}
