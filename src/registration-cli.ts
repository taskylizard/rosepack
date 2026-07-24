import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Client, type CreateApplicationCommandOptions } from 'oceanic.js'
import {
  applicationCommandKey,
  reconcileApplicationCommands,
  type ApplicationCommandKey,
  type ApplicationCommandRegistrationResult
} from './registration.ts'

export interface RegistrationCliOptions {
  readonly arguments?: readonly string[]
  readonly client?: Client
  readonly commands?: readonly {
    readonly module?: string
    readonly payload: CreateApplicationCommandOptions
  }[]
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly modules?: readonly {
    readonly description?: string
    readonly id: string
    readonly label: string
  }[]
  readonly payload?: readonly CreateApplicationCommandOptions[]
}

export interface ParsedRegistrationCliRegisterOptions {
  readonly command: 'register'
  readonly applicationID: string
  readonly cacheFile: string
  readonly dryRun: boolean
  readonly guildID?: string
  readonly modules: readonly string[]
  readonly token: string
}

export interface ParsedRegistrationCliModulesListOptions {
  readonly command: 'modules-list'
}

export type ParsedRegistrationCliOptions =
  | ParsedRegistrationCliRegisterOptions
  | ParsedRegistrationCliModulesListOptions

interface RegistrationCache {
  readonly scopes: Record<string, readonly ApplicationCommandKey[]>
  readonly version: 2
}

/** Runs the portable production registration command against Discord. */
export async function runRegistrationCli(
  options: RegistrationCliOptions
): Promise<readonly ApplicationCommandRegistrationResult[]> {
  const parsed = parseRegistrationCliOptions(
    options.arguments ?? process.argv.slice(2),
    options.environment ?? process.env
  )
  if (parsed.command === 'modules-list') {
    printModuleList(options.modules ?? [])
    return Object.freeze([])
  }
  const payload = selectRegistrationPayload(options, parsed)
  const scope = registrationScope(parsed)
  const cache = await readRegistrationCache(
    parsed.cacheFile,
    scope,
    legacyRegistrationScope(parsed)
  )
  const client = options.client ?? new Client({ auth: `Bot ${parsed.token}` })
  const results = await reconcileApplicationCommands({
    applicationID: parsed.applicationID,
    client,
    deleteMissing: true,
    dryRun: parsed.dryRun,
    guildID: parsed.guildID,
    ownedCommandKeys: new Set(cache.scopes[scope] ?? []),
    payload
  })

  printRegistrationResults(results, parsed.dryRun)
  if (!parsed.dryRun) {
    await writeRegistrationCache(parsed.cacheFile, {
      ...cache,
      scopes: {
        ...cache.scopes,
        [scope]: payload.map(applicationCommandKey)
      }
    })
  }
  return results
}

/** Parses the deliberately small CLI surface emitted into production builds. */
export function parseRegistrationCliOptions(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>>
): ParsedRegistrationCliOptions {
  if (arguments_[0] === 'modules') {
    if (arguments_.length !== 2 || arguments_[1] !== 'list') {
      throw new Error('Use `modules list` to list configured rosepack modules.')
    }
    return { command: 'modules-list' }
  }
  let cacheFile = '.rosepack/registration.json'
  let dryRun = false
  let guildID: string | undefined
  const modules: string[] = []
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === 'register') {
      continue
    }
    if (argument === '--dry-run') {
      dryRun = true
      continue
    }
    if (argument === '--guild') {
      guildID = requiredValue(arguments_, ++index, '--guild')
      continue
    }
    if (argument === '--cache') {
      cacheFile = requiredValue(arguments_, ++index, '--cache')
      continue
    }
    if (argument === '--module') {
      modules.push(requiredValue(arguments_, ++index, '--module'))
      continue
    }
    throw new Error(`Unknown rosepack registration argument: ${argument}`)
  }

  if (modules.length > 0 && guildID === undefined) {
    throw new Error('The --module option requires --guild.')
  }
  const applicationID = environment.DISCORD_APPLICATION_ID
  const token = environment.DISCORD_TOKEN
  if (applicationID === undefined || applicationID === '') {
    throw new Error('Set DISCORD_APPLICATION_ID before registering commands.')
  }
  if (token === undefined || token === '') {
    throw new Error('Set DISCORD_TOKEN before registering commands.')
  }
  return {
    command: 'register',
    applicationID,
    cacheFile: resolve(cacheFile),
    dryRun,
    guildID,
    modules: Object.freeze(modules),
    token
  }
}

function requiredValue(arguments_: readonly string[], index: number, flag: string): string {
  const value = arguments_[index]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`)
  }
  return value
}

async function readRegistrationCache(
  file: string,
  scope: string,
  legacyScope: string
): Promise<RegistrationCache> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as {
      readonly scopes?: Record<string, readonly ApplicationCommandKey[]>
      readonly version?: number
    }
    if (parsed.version === 2 && parsed.scopes !== undefined) {
      return { scopes: parsed.scopes, version: 2 }
    }
    if (parsed.version === 1 && parsed.scopes !== undefined) {
      const scopes = { ...parsed.scopes }
      const legacy = scopes[legacyScope]
      if (legacy !== undefined && scopes[scope] === undefined) {
        scopes[scope] = legacy
        delete scopes[legacyScope]
      }
      return { scopes, version: 2 }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
  return { scopes: {}, version: 2 }
}

function selectRegistrationPayload(
  options: RegistrationCliOptions,
  parsed: ParsedRegistrationCliRegisterOptions
): readonly CreateApplicationCommandOptions[] {
  if (options.commands === undefined) {
    if (parsed.modules.length > 0) {
      throw new Error('Module selection requires manifest command metadata.')
    }
    return options.payload ?? []
  }
  if (parsed.guildID === undefined) {
    return options.commands
      .filter((command) => command.module === undefined)
      .map((command) => command.payload)
  }
  if (parsed.modules.length === 0) return options.commands.map((command) => command.payload)
  const known = new Set(options.modules?.map((module) => module.id) ?? [])
  for (const module of parsed.modules) {
    if (!known.has(module)) throw new Error(`Unknown rosepack module "${module}".`)
  }
  const selected = new Set(parsed.modules)
  return options.commands
    .filter((command) => command.module !== undefined && selected.has(command.module))
    .map((command) => command.payload)
}

export function registrationScope(options: ParsedRegistrationCliRegisterOptions): string {
  return options.guildID === undefined
    ? `application:${options.applicationID}:global`
    : `application:${options.applicationID}:guild:${options.guildID}`
}

function legacyRegistrationScope(options: ParsedRegistrationCliRegisterOptions): string {
  return options.guildID === undefined ? 'global' : `guild:${options.guildID}`
}

function printModuleList(
  modules: readonly { readonly description?: string; readonly id: string; readonly label: string }[]
): void {
  if (modules.length === 0) {
    console.info('No rosepack modules are configured.')
    return
  }
  for (const module of modules) {
    const description = module.description === undefined ? '' : ` — ${module.description}`
    console.info(`${module.id}\t${module.label}${description}`)
  }
}

async function writeRegistrationCache(file: string, cache: RegistrationCache): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(cache, undefined, 2)}\n`)
}

function printRegistrationResults(
  results: readonly ApplicationCommandRegistrationResult[],
  dryRun: boolean
): void {
  const counts = { create: 0, delete: 0, unchanged: 0, update: 0 }
  for (const result of results) {
    counts[result.action] += 1
  }
  const prefix = dryRun ? 'rosepack registration dry run' : 'rosepack registration'
  console.info(
    `${prefix}: ${counts.create} created, ${counts.update} updated, ${counts.delete} deleted, ${counts.unchanged} unchanged.`
  )
}
