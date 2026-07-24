import type { Client, CommandInteraction, CreateApplicationCommandOptions } from 'oceanic.js'
import {
  applicationCommandKey,
  reconcileApplicationCommands,
  type ApplicationCommandKey,
  type ApplicationCommandRegistrationResult
} from './registration.ts'

const moduleBrand = Symbol('rosepack.module')

/** User-facing metadata for one independently enabled guild feature. */
export interface RosepackModuleDefinition {
  readonly description?: string
  readonly label: string
}

/** A typed module reference accepted by application-command definitions. */
export interface RosepackModule<TID extends string = string> extends RosepackModuleDefinition {
  readonly [moduleBrand]: true
  readonly id: TID
}

export type RosepackModuleDefinitionRecord = Readonly<Record<string, RosepackModuleDefinition>>

/** The exact module references produced from a module definition record. */
export type RosepackModuleCatalog<
  TDefinitions extends RosepackModuleDefinitionRecord = RosepackModuleDefinitionRecord
> = Readonly<{
  [ID in keyof TDefinitions]: RosepackModule<ID & string> & TDefinitions[ID]
}>

export type RosepackModuleID<TCatalog extends RosepackModuleCatalog> = Extract<
  keyof TCatalog,
  string
>

/** One exact module reference from a catalog. */
export type RosepackModuleValue<TCatalog extends RosepackModuleCatalog> =
  TCatalog[RosepackModuleID<TCatalog>]

/** A module reference or persisted ID accepted by typed module operations. */
export type RosepackModuleSelector<TCatalog extends RosepackModuleCatalog> =
  | RosepackModuleID<TCatalog>
  | RosepackModuleValue<TCatalog>

/** Defines and freezes the source of truth for persisted module IDs and display labels. */
export function defineModules<const TDefinitions extends RosepackModuleDefinitionRecord>(
  definitions: TDefinitions
): RosepackModuleCatalog<TDefinitions> {
  const catalog: Record<string, RosepackModule> = Object.create(null)
  for (const [id, definition] of Object.entries(definitions)) {
    if (id.length === 0) throw new Error('rosepack module IDs cannot be empty.')
    const module = { ...definition, id } as RosepackModule
    Object.defineProperty(module, moduleBrand, { value: true })
    catalog[id] = Object.freeze(module)
  }
  return Object.freeze(catalog) as RosepackModuleCatalog<TDefinitions>
}

/** Returns Discord choices while preserving the catalog's exact module-ID union. */
export function moduleChoices<const TCatalog extends RosepackModuleCatalog>(
  catalog: TCatalog
): readonly { readonly name: string; readonly value: RosepackModuleID<TCatalog> }[] {
  const modules = moduleValues(catalog)
  if (modules.length > 25) {
    throw new Error('Discord allows at most 25 static module choices.')
  }
  return Object.freeze(
    modules.map((module) => Object.freeze({ name: module.label, value: module.id }))
  ) as readonly { readonly name: string; readonly value: RosepackModuleID<TCatalog> }[]
}

/** Returns the catalog in deterministic definition order. */
export function moduleValues<const TCatalog extends RosepackModuleCatalog>(
  catalog: TCatalog
): readonly TCatalog[RosepackModuleID<TCatalog>][] {
  return Object.freeze(Object.values(catalog)) as readonly TCatalog[RosepackModuleID<TCatalog>][]
}

export interface RosepackModuleStateMutation {
  /** Whether this operation changed the persisted desired state. */
  readonly changed: boolean
  /** The complete desired module IDs after the atomic mutation. */
  readonly modules: readonly string[]
}

export interface RosepackModuleStateOptions<
  TApp,
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
> {
  readonly catalog: TCatalog
  /** Reads the desired enabled module IDs for one guild. */
  read(context: {
    readonly app: TApp
    readonly applicationID: string
    readonly guildID: string
  }): Promise<readonly string[]>
  /** Reads command keys previously owned by modules in this application and guild. */
  readOwnedCommandKeys(context: {
    readonly app: TApp
    readonly applicationID: string
    readonly guildID: string
  }): Promise<readonly ApplicationCommandKey[]>
  /**
   * Atomically enables or disables one module and returns the complete resulting state.
   * Implementations must serialize this read-modify-write across every bot process.
   */
  mutate(context: {
    readonly app: TApp
    readonly applicationID: string
    readonly enabled: boolean
    readonly guildID: string
    readonly module: RosepackModuleID<TCatalog>
  }): Promise<RosepackModuleStateMutation>
  /** Replaces durable ownership after safe reconciliation. */
  writeOwnedCommandKeys(context: {
    readonly app: TApp
    readonly applicationID: string
    readonly guildID: string
    readonly keys: readonly ApplicationCommandKey[]
  }): Promise<void>
  /** Handles an interaction delivered after its module was disabled. */
  onDisabled?(context: {
    readonly app: TApp
    readonly interaction: CommandInteraction
    readonly module: RosepackModuleValue<TCatalog>
  }): void | Promise<void>
}

export interface RosepackModuleMutationResult<
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
> {
  readonly changed: boolean
  readonly enabled: readonly RosepackModuleValue<TCatalog>[]
  readonly module: RosepackModuleValue<TCatalog>
  readonly registration: readonly ApplicationCommandRegistrationResult[]
}

export interface RosepackModuleSyncOptions<TApp> {
  readonly app: TApp
  readonly applicationID: string
  readonly client: Client
  readonly guildID: string
}

export class ModuleSynchronizationError extends Error {
  readonly applicationID: string
  readonly desiredModules: readonly string[]
  readonly guildID: string

  constructor(
    applicationID: string,
    guildID: string,
    desiredModules: readonly string[],
    cause: unknown
  ) {
    super(`Failed to synchronize rosepack modules for guild ${guildID}.`, { cause })
    this.name = 'ModuleSynchronizationError'
    this.applicationID = applicationID
    this.guildID = guildID
    this.desiredModules = Object.freeze([...desiredModules])
  }
}

interface ModuleCommandEntry {
  readonly module: RosepackModule
  readonly payload: CreateApplicationCommandOptions
}

/** Persistence-backed selection and reconciliation for one registry's modular commands. */
export class RosepackModuleManager<
  TApp,
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
> {
  readonly catalog: TCatalog
  readonly #byID: ReadonlyMap<string, RosepackModuleValue<TCatalog>>
  readonly #entries: readonly ModuleCommandEntry[]
  readonly #options?: RosepackModuleStateOptions<TApp, TCatalog>
  readonly #ownedCommandKeys: ReadonlySet<ApplicationCommandKey>
  readonly #queues = new Map<string, Promise<void>>()

  constructor(
    entries: readonly ModuleCommandEntry[],
    catalog?: TCatalog,
    options?: RosepackModuleStateOptions<TApp, TCatalog>
  ) {
    this.#options = options
    this.catalog = (catalog ?? options?.catalog ?? Object.freeze(Object.create(null))) as TCatalog
    if (catalog !== undefined && options !== undefined && catalog !== options.catalog) {
      throw new Error(
        'Registry and module state adapter must use the same rosepack module catalog.'
      )
    }
    this.#byID = new Map(moduleValues(this.catalog).map((module) => [module.id, module]))
    this.#entries = Object.freeze(
      entries.map((entry) => {
        const configured = this.#byID.get(entry.module.id)
        if (configured === undefined) {
          throw new Error(`Command references unknown rosepack module "${entry.module.id}".`)
        }
        return Object.freeze({ module: configured, payload: entry.payload })
      })
    )
    this.#ownedCommandKeys = new Set(entries.map((entry) => applicationCommandKey(entry.payload)))
    Object.freeze(this)
  }

  context(config: {
    readonly app: TApp
    readonly applicationID: string
    readonly client: Client
    readonly guildID: string | null
  }): RosepackModuleContext<TApp, TCatalog> {
    return new RosepackModuleContext(this, config)
  }

  async list(config: {
    readonly app: TApp
    readonly applicationID: string
    readonly guildID: string
  }): Promise<readonly RosepackModuleValue<TCatalog>[]> {
    return this.#resolve(await this.#requiredOptions().read(config))
  }

  async isEnabled(config: {
    readonly app: TApp
    readonly applicationID: string
    readonly guildID: string
    readonly module: RosepackModuleSelector<TCatalog>
  }): Promise<boolean> {
    const module = this.#module(config.module)
    return (await this.list(config)).some((enabled) => enabled.id === module.id)
  }

  async enable(
    config: RosepackModuleSyncOptions<TApp> & {
      readonly module: RosepackModuleSelector<TCatalog>
    }
  ): Promise<RosepackModuleMutationResult<TCatalog>> {
    return this.#serialize(config, () => this.#mutate(config, true))
  }

  async disable(
    config: RosepackModuleSyncOptions<TApp> & {
      readonly module: RosepackModuleSelector<TCatalog>
    }
  ): Promise<RosepackModuleMutationResult<TCatalog>> {
    return this.#serialize(config, () => this.#mutate(config, false))
  }

  async sync(
    config: RosepackModuleSyncOptions<TApp>
  ): Promise<readonly ApplicationCommandRegistrationResult[]> {
    return this.#serialize(config, async () => {
      const enabled = await this.list(config)
      try {
        return (await this.#synchronize(config, enabled)).registration
      } catch (error) {
        throw new ModuleSynchronizationError(
          config.applicationID,
          config.guildID,
          enabled.map(({ id }) => id),
          error
        )
      }
    })
  }

  async syncAll(
    config: Omit<RosepackModuleSyncOptions<TApp>, 'guildID'> & {
      readonly concurrency?: number
      readonly guildIDs: Iterable<string>
    }
  ): Promise<ReadonlyMap<string, readonly ApplicationCommandRegistrationResult[]>> {
    const guildIDs = [...new Set(config.guildIDs)]
    const concurrency = Math.max(1, Math.floor(config.concurrency ?? 5))
    const results = new Map<string, readonly ApplicationCommandRegistrationResult[]>()
    let index = 0
    await Promise.all(
      Array.from({ length: Math.min(concurrency, guildIDs.length) }, async () => {
        while (index < guildIDs.length) {
          const guildID = guildIDs[index++]!
          results.set(guildID, await this.sync({ ...config, guildID }))
        }
      })
    )
    return results
  }

  async handleDisabled(config: {
    readonly app: TApp
    readonly interaction: CommandInteraction
    readonly module: RosepackModule
  }): Promise<boolean> {
    // A catalog can be used for registration/build validation without opting into
    // persistence-backed runtime gating. In that mode, leave dispatch unchanged.
    if (this.#options === undefined) return false
    const module = this.#module(config.module as RosepackModuleSelector<TCatalog>)
    const guildID = config.interaction.guildID
    if (
      guildID !== null &&
      (await this.isEnabled({
        ...config,
        applicationID: config.interaction.applicationID,
        guildID,
        module
      }))
    )
      return false
    await this.#options?.onDisabled?.({ ...config, module })
    return true
  }

  async #mutate(
    config: RosepackModuleSyncOptions<TApp> & {
      readonly module: RosepackModuleSelector<TCatalog>
    },
    enable: boolean
  ): Promise<RosepackModuleMutationResult<TCatalog>> {
    const options = this.#requiredOptions()
    const module = this.#module(config.module)
    const mutation = await options.mutate({
      app: config.app,
      applicationID: config.applicationID,
      enabled: enable,
      guildID: config.guildID,
      module: module.id as RosepackModuleID<TCatalog>
    })
    const enabled = this.#resolve(mutation.modules)
    const persisted = enabled.some((entry) => entry.id === module.id)
    if (persisted !== enable) {
      throw new Error(
        `Rosepack module state adapter returned ${JSON.stringify(mutation.modules)} after being asked to ${enable ? 'enable' : 'disable'} "${module.id}".`
      )
    }
    try {
      const synchronized = await this.#synchronize(config, enabled)
      return Object.freeze({
        changed: mutation.changed,
        enabled: synchronized.enabled,
        module,
        registration: synchronized.registration
      })
    } catch (error) {
      throw new ModuleSynchronizationError(
        config.applicationID,
        config.guildID,
        mutation.modules,
        error
      )
    }
  }

  async #synchronize(
    config: RosepackModuleSyncOptions<TApp>,
    initial: readonly RosepackModuleValue<TCatalog>[]
  ): Promise<{
    readonly enabled: readonly RosepackModuleValue<TCatalog>[]
    readonly registration: readonly ApplicationCommandRegistrationResult[]
  }> {
    let enabled = initial
    const registration: ApplicationCommandRegistrationResult[] = []
    for (let attempt = 0; attempt < 8; attempt += 1) {
      registration.push(...(await this.#reconcile(config, enabled)))
      const latest = await this.list(config)
      if (sameModuleSelection(enabled, latest)) {
        return Object.freeze({
          enabled: latest,
          registration: Object.freeze(registration)
        })
      }
      enabled = latest
    }
    throw new Error('Rosepack module state kept changing during Discord synchronization.')
  }

  async #reconcile(
    config: RosepackModuleSyncOptions<TApp>,
    enabled: readonly RosepackModuleValue<TCatalog>[]
  ): Promise<readonly ApplicationCommandRegistrationResult[]> {
    const ids = new Set(enabled.map((module) => module.id))
    const options = this.#requiredOptions()
    const ownershipContext = {
      app: config.app,
      applicationID: config.applicationID,
      guildID: config.guildID
    }
    const previousOwned = await options.readOwnedCommandKeys(ownershipContext)
    const safeOwned = new Set([...previousOwned, ...this.#ownedCommandKeys])
    await options.writeOwnedCommandKeys({ ...ownershipContext, keys: [...safeOwned] })
    const results = await reconcileApplicationCommands({
      applicationID: config.applicationID,
      client: config.client,
      deleteMissing: true,
      guildID: config.guildID,
      ownedCommandKeys: safeOwned,
      payload: this.#entries
        .filter((entry) => ids.has(entry.module.id))
        .map((entry) => entry.payload)
    })
    await options.writeOwnedCommandKeys({
      ...ownershipContext,
      keys: [...this.#ownedCommandKeys]
    })
    return results
  }

  async #serialize<TResult>(
    config: Pick<RosepackModuleSyncOptions<TApp>, 'applicationID' | 'guildID'>,
    operation: () => Promise<TResult>
  ): Promise<TResult> {
    const key = `${config.applicationID}:${config.guildID}`
    const previous = this.#queues.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => current)
    this.#queues.set(key, tail)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.#queues.get(key) === tail) this.#queues.delete(key)
    }
  }

  #resolve(ids: readonly string[]): readonly RosepackModuleValue<TCatalog>[] {
    return Object.freeze(ids.map((id) => this.#module(id as RosepackModuleID<TCatalog>)))
  }

  #module(module: RosepackModuleSelector<TCatalog>): RosepackModuleValue<TCatalog> {
    const id = typeof module === 'string' ? module : module.id
    const configured = this.#byID.get(id)
    if (configured === undefined) throw new Error(`Unknown rosepack module "${id}".`)
    return configured
  }

  #requiredOptions(): RosepackModuleStateOptions<TApp, TCatalog> {
    if (this.#options === undefined) {
      throw new Error('This rosepack registry has no module state adapter.')
    }
    return this.#options
  }
}

/** Module operations bound to the current interaction's app and guild. */
export class RosepackModuleContext<
  TApp,
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
> {
  readonly #app: TApp
  readonly #applicationID: string
  readonly #client: Client
  readonly #guildID: string | null
  readonly #manager: RosepackModuleManager<TApp, TCatalog>

  constructor(
    manager: RosepackModuleManager<TApp, TCatalog>,
    config: {
      readonly app: TApp
      readonly applicationID: string
      readonly client: Client
      readonly guildID: string | null
    }
  ) {
    this.#manager = manager
    this.#app = config.app
    this.#applicationID = config.applicationID
    this.#client = config.client
    this.#guildID = config.guildID
  }

  list(): Promise<readonly RosepackModuleValue<TCatalog>[]> {
    return this.#manager.list(this.#scope())
  }

  isEnabled(module: RosepackModuleSelector<TCatalog>): Promise<boolean> {
    return this.#manager.isEnabled({ ...this.#scope(), module })
  }

  enable(
    module: RosepackModuleSelector<TCatalog>
  ): Promise<RosepackModuleMutationResult<TCatalog>> {
    return this.#manager.enable({ ...this.#scope(), module })
  }

  disable(
    module: RosepackModuleSelector<TCatalog>
  ): Promise<RosepackModuleMutationResult<TCatalog>> {
    return this.#manager.disable({ ...this.#scope(), module })
  }

  #scope(): RosepackModuleSyncOptions<TApp> {
    if (this.#guildID === null) throw new Error('Rosepack modules are available only in guilds.')
    return {
      app: this.#app,
      applicationID: this.#applicationID,
      client: this.#client,
      guildID: this.#guildID
    }
  }
}

function sameModuleSelection(
  left: readonly RosepackModule[],
  right: readonly RosepackModule[]
): boolean {
  if (left.length !== right.length) return false
  const rightIDs = new Set(right.map((module) => module.id))
  return left.every((module) => rightIDs.has(module.id))
}
