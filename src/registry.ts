import {
  ApplicationCommandOptionTypes,
  ApplicationCommandTypes,
  CommandInteraction,
  ModalSubmitInteraction
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
  createMessageContextMenuDefinition,
  createUserContextMenuDefinition,
  type ContextMenuDefinition,
  type MessageContextMenuDefinition,
  type MessageMenuBuilder,
  type UserContextMenuDefinition,
  type UserMenuBuilder
} from './context-menus.ts'
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
import {
  ApplicationCommandValidationError,
  ModalValidationError,
  ModalValueError
} from './errors.ts'
import { invocationTrail, invokeRegistryCommand } from './internal.ts'
import { ContextMenuCommandContext, ModalContext } from './interaction-context.ts'
import { integrationTypeByInstallation, interactionContextTypeByName } from './metadata.ts'
import {
  createModalDefinition,
  type AnyModalDefinition,
  type ModalBuilder,
  type ModalDefinition,
  type ModalFieldRecord,
  type ModalFieldValues
} from './modals.ts'
import { createPrefixCommands, type CreatePrefixCommands } from './prefix-registry.ts'
import { createPrefixParser, type DefinePrefixParser } from './prefix-parsers.ts'
import { CommandTreeValidationError, lintSlashCommandTree } from './validation.ts'

/** Configuration shared by registries created from one rosepack instance. */
export interface RosepackOptions<TApp> {
  /** Called when Discord sends a chat-input command that is not present in the registry. */
  onUnknownCommand?(context: {
    app: TApp
    interaction: CommandInteraction
    registry: InteractionRegistry<TApp>
  }): void | Promise<void>
  onUnknownModal?(context: {
    app: TApp
    interaction: ModalSubmitInteraction
    registry: InteractionRegistry<TApp>
  }): void | Promise<void>
}

export interface InteractionRegistryDefinitions<TApp> {
  readonly messageContextMenus?: readonly MessageContextMenuDefinition<TApp>[]
  readonly modals?: readonly AnyModalDefinition<TApp>[]
  readonly slashCommands?: readonly SlashRootCommandDefinitionBase<TApp>[]
  readonly userContextMenus?: readonly UserContextMenuDefinition<TApp>[]
}

interface RuntimeModal<TApp> {
  readonly definition: AnyModalDefinition<TApp>
  readonly parameterNames: readonly string[]
  readonly pattern: RegExp
  readonly shape: string
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

/** A validated, frozen, searchable, and dispatchable collection of interactions. */
export class InteractionRegistry<TApp> {
  /** Frozen Discord registration payloads in the same order as the root commands. */
  readonly payload: readonly CreateApplicationCommandOptions[]
  readonly messageContextMenus: readonly MessageContextMenuDefinition<TApp>[]
  readonly modals: readonly AnyModalDefinition<TApp>[]
  readonly slashCommands: readonly SlashRootCommandDefinitionBase<TApp>[]
  /** Frozen command-tree roots available for inspection and routing. */
  readonly tree: readonly SlashCommandTreeNode<TApp>[]
  readonly userContextMenus: readonly UserContextMenuDefinition<TApp>[]
  readonly #byDefinition: WeakMap<object, RuntimeSlashNode<TApp>>
  readonly #byPath: ReadonlyMap<string, SlashCommandTreeNode<TApp>>
  readonly #options: RosepackOptions<TApp>
  readonly #messageMenusByName: ReadonlyMap<string, MessageContextMenuDefinition<TApp>>
  readonly #modalsByRoute: ReadonlyMap<string, AnyModalDefinition<TApp>>
  readonly #modalRoutes: readonly RuntimeModal<TApp>[]
  readonly #rootsByName: ReadonlyMap<string, RuntimeSlashNode<TApp>>
  readonly #runtimeByPublic: WeakMap<SlashCommandTreeNode<TApp>, RuntimeSlashNode<TApp>>
  readonly #userMenusByName: ReadonlyMap<string, UserContextMenuDefinition<TApp>>

  constructor(config: {
    byDefinition: WeakMap<object, RuntimeSlashNode<TApp>>
    byPath: ReadonlyMap<string, SlashCommandTreeNode<TApp>>
    messageContextMenus: readonly MessageContextMenuDefinition<TApp>[]
    modalRoutes: readonly RuntimeModal<TApp>[]
    modals: readonly AnyModalDefinition<TApp>[]
    options: RosepackOptions<TApp>
    payload: readonly CreateApplicationCommandOptions[]
    rootsByName: ReadonlyMap<string, RuntimeSlashNode<TApp>>
    runtimeByPublic: WeakMap<SlashCommandTreeNode<TApp>, RuntimeSlashNode<TApp>>
    slashCommands: readonly SlashRootCommandDefinitionBase<TApp>[]
    tree: readonly SlashCommandTreeNode<TApp>[]
    userContextMenus: readonly UserContextMenuDefinition<TApp>[]
  }) {
    this.#byDefinition = config.byDefinition
    this.#byPath = config.byPath
    this.#options = config.options
    this.messageContextMenus = config.messageContextMenus
    this.modals = config.modals
    this.slashCommands = config.slashCommands
    this.userContextMenus = config.userContextMenus
    this.#messageMenusByName = new Map(config.messageContextMenus.map((menu) => [menu.name, menu]))
    this.#modalsByRoute = new Map(config.modals.map((modal) => [modal.customID, modal]))
    this.#modalRoutes = config.modalRoutes
    this.#rootsByName = config.rootsByName
    this.#runtimeByPublic = config.runtimeByPublic
    this.#userMenusByName = new Map(config.userContextMenus.map((menu) => [menu.name, menu]))
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

  getModal(route: string): AnyModalDefinition<TApp> | undefined {
    return this.#modalsByRoute.get(route)
  }

  getUserContextMenu(name: string): UserContextMenuDefinition<TApp> | undefined {
    return this.#userMenusByName.get(name)
  }

  getMessageContextMenu(name: string): MessageContextMenuDefinition<TApp> | undefined {
    return this.#messageMenusByName.get(name)
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
    if (interaction instanceof ModalSubmitInteraction) {
      await this.#dispatchModal(app, interaction)
      return
    }
    if (!(interaction instanceof CommandInteraction)) return
    if (interaction.isUserCommand()) {
      await this.#dispatchContextMenu(app, interaction, 'user')
      return
    }
    if (interaction.isMessageCommand()) {
      await this.#dispatchContextMenu(app, interaction, 'message')
      return
    }
    if (!interaction.isChatInputCommand()) return
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

  async #dispatchContextMenu(
    app: TApp,
    interaction: CommandInteraction,
    kind: 'message' | 'user'
  ): Promise<void> {
    const definition =
      kind === 'user'
        ? this.#userMenusByName.get(interaction.data.name)
        : this.#messageMenusByName.get(interaction.data.name)
    if (definition === undefined) {
      await this.#options.onUnknownCommand?.({ app, interaction, registry: this })
      return
    }
    const target = interaction.data.target
    if (target === null) throw new Error(`Context menu "${definition.name}" has no target.`)
    const context = new ContextMenuCommandContext({
      app,
      command: definition,
      interaction: interaction as never,
      registry: this,
      target: target as never
    })
    try {
      await definition.beforeExecute?.(context as never)
      await definition.execute(context as never)
    } catch (error) {
      if (definition.onError === undefined) throw error
      await definition.onError(context as never, error)
    }
  }

  async #dispatchModal(app: TApp, interaction: ModalSubmitInteraction): Promise<void> {
    for (const runtime of this.#modalRoutes) {
      const match = runtime.pattern.exec(interaction.data.customID)
      if (match === null) continue
      const params = Object.create(null) as Record<string, string>
      for (const [index, name] of runtime.parameterNames.entries()) {
        params[name] = decodeURIComponent(match[index + 1]!)
      }
      const values = parseModalValues(runtime.definition.fields, interaction)
      const context = new ModalContext<TApp, string, ModalFieldRecord>({
        app,
        interaction,
        modal: runtime.definition as ModalDefinition<TApp, string, ModalFieldRecord>,
        params,
        registry: this,
        values: values as ModalFieldValues<ModalFieldRecord>
      })
      try {
        await runtime.definition.beforeExecute?.(context as never)
        await runtime.definition.execute(context as never)
      } catch (error) {
        if (runtime.definition.onError === undefined) throw error
        await runtime.definition.onError(context as never, error)
      }
      return
    }
    await this.#options.onUnknownModal?.({ app, interaction, registry: this })
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
  /** Creates a registry from command definitions already validated by the Rosepack compiler. */
  createCompiledRegistry(
    definitions: InteractionRegistryDefinitions<TApp>
  ): InteractionRegistry<TApp>
  /** Creates a typed prefix-command scope with built-in and optional custom parsers. */
  createPrefixCommands: CreatePrefixCommands<TApp>
  /** Creates and freezes a validated command registry. */
  createRegistry(definitions: InteractionRegistryDefinitions<TApp>): InteractionRegistry<TApp>
  /** Defines a message context-menu command with a narrowed Message target. */
  messageMenu: MessageMenuBuilder<TApp>
  /** Defines a routed, typed modal. */
  modal: ModalBuilder<TApp>
  /** Defines a root slash command while preserving local option inference. */
  slash: SlashBuilder<TApp>
  /** Defines an executable slash subcommand while preserving local option inference. */
  slashSub: DefineSlashSub<TApp>
  /** Defines a user context-menu command with a narrowed User target. */
  userMenu: UserMenuBuilder<TApp>
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
    createCompiledRegistry: (definitions) => buildCompiledInteractionRegistry(definitions, options),
    createPrefixCommands: createPrefixCommands as CreatePrefixCommands<TApp>,
    createRegistry: (definitions) => buildInteractionRegistry(definitions, options),
    messageMenu: createMessageContextMenuDefinition as MessageMenuBuilder<TApp>,
    modal: createModalDefinition as ModalBuilder<TApp>,
    prefixParser: createPrefixParser as DefinePrefixParser<TApp>,
    slash: createSlashCommandDefinition as SlashBuilder<TApp>,
    slashSub: createSubcommandDefinition as DefineSlashSub<TApp>,
    userMenu: createUserContextMenuDefinition as UserMenuBuilder<TApp>
  }
}

export function buildInteractionRegistry<TApp>(
  definitions: InteractionRegistryDefinitions<TApp>,
  options: RosepackOptions<TApp> = {}
): InteractionRegistry<TApp> {
  const slashCommands = definitions.slashCommands ?? []
  const issues = lintSlashCommandTree(slashCommands)
  if (issues.length > 0) throw new CommandTreeValidationError(issues)
  validateInteractionDefinitions(definitions)
  return buildCompiledInteractionRegistry(definitions, options)
}

/**
 * Validates definitions and builds a frozen registry.
 * @throws {CommandTreeValidationError} when any definition violates rosepack or Discord rules.
 */
export function buildSlashCommandTree<TApp>(
  commands: readonly SlashRootCommandDefinitionBase<TApp>[],
  options: RosepackOptions<TApp> = {}
): InteractionRegistry<TApp> {
  return buildInteractionRegistry({ slashCommands: commands }, options)
}

/** Builds a registry from compiler-validated commands without repeating tree lint checks. */
export function buildCompiledSlashCommandTree<TApp>(
  commands: readonly SlashRootCommandDefinitionBase<TApp>[],
  options: RosepackOptions<TApp> = {}
): InteractionRegistry<TApp> {
  return buildCompiledInteractionRegistry({ slashCommands: commands }, options)
}

export function buildCompiledInteractionRegistry<TApp>(
  definitions: InteractionRegistryDefinitions<TApp>,
  options: RosepackOptions<TApp> = {}
): InteractionRegistry<TApp> {
  const commands = definitions.slashCommands ?? []
  const userContextMenus = definitions.userContextMenus ?? []
  const messageContextMenus = definitions.messageContextMenus ?? []
  const modals = definitions.modals ?? []
  const byDefinition = new WeakMap<object, RuntimeSlashNode<TApp>>()
  const byPath = new Map<string, SlashCommandTreeNode<TApp>>()
  const runtimeByPublic = new WeakMap<SlashCommandTreeNode<TApp>, RuntimeSlashNode<TApp>>()
  const roots = commands.map((command) =>
    buildRootNode(command, byDefinition, byPath, runtimeByPublic)
  )
  const rootsByName = new Map(roots.map((root) => [root.public.name, root] as const))
  const payload = deepFreeze([
    ...commands.map(commandToDiscordUnchecked),
    ...userContextMenus.map(contextMenuToDiscord),
    ...messageContextMenus.map(contextMenuToDiscord)
  ])
  const modalRoutes = modals.map(compileModalRoute)

  for (const command of commands) {
    freezeCommandDefinition(command)
  }

  return new InteractionRegistry({
    byDefinition,
    byPath,
    messageContextMenus: Object.freeze([...messageContextMenus]),
    modalRoutes,
    modals: Object.freeze([...modals]),
    options,
    payload,
    rootsByName,
    runtimeByPublic,
    slashCommands: Object.freeze([...commands]),
    tree: Object.freeze(roots.map((root) => root.public)),
    userContextMenus: Object.freeze([...userContextMenus])
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

export function contextMenuToDiscord(
  command: ContextMenuDefinition<unknown>
): CreateApplicationCommandOptions {
  return deepFreeze({
    contexts: command.contexts?.map((context) => interactionContextTypeByName[context]),
    integrationTypes: command.installations?.map(
      (installation) => integrationTypeByInstallation[installation]
    ),
    name: command.name,
    type: command.kind === 'user' ? ApplicationCommandTypes.USER : ApplicationCommandTypes.MESSAGE
  })
}

function validateInteractionDefinitions<TApp>(
  definitions: InteractionRegistryDefinitions<TApp>
): void {
  validateNamedDefinitions('user context menu', definitions.userContextMenus ?? [])
  validateNamedDefinitions('message context menu', definitions.messageContextMenus ?? [])
  const modalRoutes: RuntimeModal<TApp>[] = []
  for (const modal of definitions.modals ?? []) {
    const customID = modal.customID as string
    const title = modal.title as string
    if (title.length < 1 || title.length > 45) {
      throw new ModalValidationError(
        'title-length',
        `Modal "${customID}" title must be between 1 and 45 characters.`
      )
    }
    const fields = Object.entries(modal.fields as ModalFieldRecord)
    if (fields.length < 1 || fields.length > 5) {
      throw new ModalValidationError(
        'field-count',
        `Modal "${customID}" must define between 1 and 5 fields.`
      )
    }
    const route = compileModalRoute(modal)
    for (const previous of modalRoutes) {
      if (modalRoutesOverlap(previous.definition.customID as string, customID)) {
        throw new ModalValidationError(
          'ambiguous-route',
          `Modal routes "${String(previous.definition.customID)}" and "${customID}" are ambiguous at runtime.`
        )
      }
    }
    modalRoutes.push(route)
    for (const [name, field] of fields) {
      if (name.length < 1 || name.length > 100) {
        throw new ModalValidationError(
          'field-id-length',
          `Modal field custom ID "${name}" must be between 1 and 100 characters.`
        )
      }
      if (field.label.length < 1 || field.label.length > 45) {
        throw new ModalValidationError(
          'field-label-length',
          `Modal field "${name}" label must be between 1 and 45 characters.`
        )
      }
      if (
        field.minLength !== undefined &&
        field.maxLength !== undefined &&
        field.minLength > field.maxLength
      ) {
        throw new ModalValidationError(
          'field-length-range',
          `Modal field "${name}" minLength cannot exceed maxLength.`
        )
      }
    }
  }
}

function validateNamedDefinitions(
  kind: string,
  definitions: readonly { readonly name: string }[]
): void {
  const names = new Set<string>()
  for (const definition of definitions) {
    if (definition.name.length < 1 || definition.name.length > 32) {
      throw new ApplicationCommandValidationError(
        'invalid-name-length',
        `${kind} name "${definition.name}" must be between 1 and 32 characters.`
      )
    }
    if (names.has(definition.name))
      throw new ApplicationCommandValidationError(
        'duplicate-name',
        `Duplicate ${kind} name "${definition.name}".`
      )
    names.add(definition.name)
  }
}

function compileModalRoute<TApp>(modal: AnyModalDefinition<TApp>): RuntimeModal<TApp> {
  const customID = modal.customID as string
  if (customID.length < 1 || customID.length > 100) {
    throw new ModalValidationError(
      'route-length',
      `Modal route must be between 1 and 100 characters: "${customID}".`
    )
  }
  const parameterNames: string[] = []
  const segments: string[] = customID.split('/')
  if (segments.some((segment) => segment === '')) {
    throw new ModalValidationError(
      'empty-route-segment',
      `Modal route "${customID}" cannot contain empty segments.`
    )
  }
  const patternSegments = segments.map((segment) => {
    if (!segment.startsWith(':')) return escapeRegularExpression(segment)
    const name = segment.slice(1)
    if (!/^[A-Za-z_$][\w$]*$/u.test(name)) {
      throw new ModalValidationError(
        'invalid-parameter',
        `Modal route parameter "${name}" is not a valid TypeScript identifier.`
      )
    }
    if (parameterNames.includes(name)) {
      throw new ModalValidationError(
        'duplicate-parameter',
        `Modal route "${customID}" repeats parameter "${name}".`
      )
    }
    parameterNames.push(name)
    return '([^/]+)'
  })
  return Object.freeze({
    definition: modal,
    parameterNames: Object.freeze(parameterNames),
    pattern: new RegExp(`^${patternSegments.join('/')}$`, 'u'),
    shape: segments.map((segment) => (segment.startsWith(':') ? ':' : segment)).join('/')
  })
}

function parseModalValues(
  fields: ModalFieldRecord,
  interaction: ModalSubmitInteraction
): ModalFieldValues<ModalFieldRecord> {
  const values = Object.create(null) as Record<string, string | undefined>
  for (const [name, field] of Object.entries(fields)) {
    const value = interaction.data.components.getTextInput(name)
    if (field.required === true && value === undefined) {
      throw new ModalValueError(name)
    }
    if (value !== undefined) values[name] = value
  }
  return values as ModalFieldValues<ModalFieldRecord>
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function modalRoutesOverlap(left: string, right: string): boolean {
  const leftSegments = left.split('/')
  const rightSegments = right.split('/')
  if (leftSegments.length !== rightSegments.length) return false
  return leftSegments.every((segment, index) => {
    const other = rightSegments[index]!
    return segment.startsWith(':') || other.startsWith(':') || segment === other
  })
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
