import type {
  Client,
  CreateApplicationCommandOptions,
  CreateGuildApplicationCommandOptions
} from 'oceanic.js'

/** Stable identity for one Discord application command within a registration scope. */
export type ApplicationCommandKey = `${number}:${string}`

export type ApplicationCommandRegistrationAction = 'create' | 'delete' | 'unchanged' | 'update'

/** One command comparison and the mutation rosepack performed or would perform. */
export interface ApplicationCommandRegistrationResult {
  readonly action: ApplicationCommandRegistrationAction
  readonly id?: string
  readonly key: ApplicationCommandKey
  readonly name: string
  readonly type: number
}

/** Options for incremental global or guild application-command reconciliation. */
export interface ReconcileApplicationCommandsOptions {
  readonly applicationID: string
  readonly client: Client
  /** Delete remote commands absent locally only when their keys appear in `ownedCommandKeys`. */
  readonly deleteMissing?: boolean
  /** Calculate and return mutations without sending create, update, or delete requests. */
  readonly dryRun?: boolean
  /** When present, registration targets this guild; otherwise it targets global commands. */
  readonly guildID?: string
  /** Keys previously recorded as rosepack-owned. Unowned remote commands are never deleted. */
  readonly ownedCommandKeys?: ReadonlySet<ApplicationCommandKey>
  readonly payload: readonly CreateApplicationCommandOptions[]
}

interface RemoteApplicationCommand extends Record<string, unknown> {
  readonly id: string
  readonly name: string
  readonly type: number
}

/**
 * Reconciles application commands without using Discord's destructive bulk-overwrite endpoints.
 * Existing commands are compared by type and name, then only changed payloads are edited.
 */
export async function reconcileApplicationCommands(
  options: ReconcileApplicationCommandsOptions
): Promise<readonly ApplicationCommandRegistrationResult[]> {
  const route = options.client.rest.applications
  const remote = (options.guildID === undefined
    ? await route.getGlobalCommands(options.applicationID)
    : await route.getGuildCommands(
        options.applicationID,
        options.guildID
      )) as unknown as RemoteApplicationCommand[]
  const remoteByKey = new Map(remote.map((command) => [applicationCommandKey(command), command]))
  const results: ApplicationCommandRegistrationResult[] = []

  for (const command of options.payload) {
    const desired = options.guildID === undefined ? command : toGuildPayload(command)
    const key = applicationCommandKey(desired)
    const existing = remoteByKey.get(key)
    remoteByKey.delete(key)
    if (existing === undefined) {
      if (!options.dryRun) {
        if (options.guildID === undefined) {
          await route.createGlobalCommand(options.applicationID, command)
        } else {
          await route.createGuildCommand(
            options.applicationID,
            options.guildID,
            desired as CreateGuildApplicationCommandOptions
          )
        }
      }
      results.push({ action: 'create', key, name: command.name, type: command.type })
      continue
    }

    if (commandPayloadsEqual(desired, existing)) {
      results.push({
        action: 'unchanged',
        id: existing.id,
        key,
        name: command.name,
        type: command.type
      })
      continue
    }

    if (!options.dryRun) {
      if (options.guildID === undefined) {
        await route.editGlobalCommand(options.applicationID, existing.id, command)
      } else {
        await route.editGuildCommand(
          options.applicationID,
          options.guildID,
          existing.id,
          desired as CreateGuildApplicationCommandOptions
        )
      }
    }
    results.push({
      action: 'update',
      id: existing.id,
      key,
      name: command.name,
      type: command.type
    })
  }

  if (options.deleteMissing) {
    for (const [key, command] of remoteByKey) {
      if (!options.ownedCommandKeys?.has(key)) {
        continue
      }
      if (!options.dryRun) {
        if (options.guildID === undefined) {
          await route.deleteGlobalCommand(options.applicationID, command.id)
        } else {
          await route.deleteGuildCommand(options.applicationID, options.guildID, command.id)
        }
      }
      results.push({
        action: 'delete',
        id: command.id,
        key,
        name: command.name,
        type: command.type
      })
    }
  }

  return Object.freeze(results.map((result) => Object.freeze(result)))
}

/** Returns the stable type-and-name identity used by Discord command upserts. */
export function applicationCommandKey(command: {
  readonly name: string
  readonly type: number
}): ApplicationCommandKey {
  return `${command.type}:${command.name}`
}

const commandFields = [
  'contexts',
  'defaultMemberPermissions',
  'description',
  'descriptionLocalizations',
  'dmPermission',
  'handler',
  'integrationTypes',
  'name',
  'nameLocalizations',
  'nsfw',
  'options',
  'type'
] as const

const optionFields = [
  'autocomplete',
  'channelTypes',
  'choices',
  'description',
  'descriptionLocalizations',
  'maxLength',
  'maxValue',
  'minLength',
  'minValue',
  'name',
  'nameLocalizations',
  'options',
  'required',
  'type'
] as const

function commandPayloadsEqual(
  desired: CreateApplicationCommandOptions | CreateGuildApplicationCommandOptions,
  remote: RemoteApplicationCommand
): boolean {
  const desiredShape = pickFields(desired, false)
  const remoteShape = projectToShape(pickFields(remote, false), desiredShape)
  return stableSerialize(desiredShape) === stableSerialize(remoteShape)
}

function projectToShape(value: unknown, shape: unknown): unknown {
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) return value
    return shape.map((item, index) => projectToShape(value[index], item))
  }
  if (shape === null || typeof shape !== 'object') return value
  if (value === null || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  const template = shape as Record<string, unknown>
  const result: Record<string, unknown> = Object.create(null)
  for (const key of Object.keys(template)) {
    result[key] = projectToShape(source[key], template[key])
  }
  return result
}

function pickFields(value: unknown, nested: boolean): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => pickFields(item, true))
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = Object.create(null)
  const fields = nested ? optionFields : commandFields
  for (const field of fields) {
    const child = readRegistrationField(source, field)
    if (child !== undefined) {
      result[field] = pickFields(child, true)
    }
  }
  return result
}

const registrationFieldAliases: Readonly<Record<string, string>> = {
  maxLength: 'max_length',
  maxValue: 'max_value',
  minLength: 'min_length',
  minValue: 'min_value'
}

function readRegistrationField(source: Record<string, unknown>, field: string): unknown {
  const value = source[field]
  if (value !== undefined) return value
  const alias = registrationFieldAliases[field]
  return alias === undefined ? undefined : source[alias]
}

function toGuildPayload(
  command: CreateApplicationCommandOptions
): CreateGuildApplicationCommandOptions {
  const { contexts: _contexts, integrationTypes: _integrationTypes, ...guildCommand } = command
  return guildCommand as CreateGuildApplicationCommandOptions
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
