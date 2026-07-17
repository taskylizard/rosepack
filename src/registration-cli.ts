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
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly payload: readonly CreateApplicationCommandOptions[]
}

export interface ParsedRegistrationCliOptions {
  readonly applicationID: string
  readonly cacheFile: string
  readonly dryRun: boolean
  readonly guildID?: string
  readonly token: string
}

interface RegistrationCache {
  readonly scopes: Record<string, readonly ApplicationCommandKey[]>
  readonly version: 1
}

/** Runs the portable production registration command against Discord. */
export async function runRegistrationCli(
  options: RegistrationCliOptions
): Promise<readonly ApplicationCommandRegistrationResult[]> {
  const parsed = parseRegistrationCliOptions(
    options.arguments ?? process.argv.slice(2),
    options.environment ?? process.env
  )
  const cache = await readRegistrationCache(parsed.cacheFile)
  const scope = parsed.guildID === undefined ? 'global' : `guild:${parsed.guildID}`
  const client = new Client({ auth: `Bot ${parsed.token}` })
  const results = await reconcileApplicationCommands({
    applicationID: parsed.applicationID,
    client,
    deleteMissing: true,
    dryRun: parsed.dryRun,
    guildID: parsed.guildID,
    ownedCommandKeys: new Set(cache.scopes[scope] ?? []),
    payload: options.payload
  })

  printRegistrationResults(results, parsed.dryRun)
  if (!parsed.dryRun) {
    await writeRegistrationCache(parsed.cacheFile, {
      ...cache,
      scopes: {
        ...cache.scopes,
        [scope]: options.payload.map(applicationCommandKey)
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
  let cacheFile = '.rosepack/registration.json'
  let dryRun = false
  let guildID: string | undefined
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
    throw new Error(`Unknown rosepack registration argument: ${argument}`)
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
    applicationID,
    cacheFile: resolve(cacheFile),
    dryRun,
    guildID,
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

async function readRegistrationCache(file: string): Promise<RegistrationCache> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<RegistrationCache>
    if (parsed.version === 1 && parsed.scopes !== undefined) {
      return { scopes: parsed.scopes, version: 1 }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
  return { scopes: {}, version: 1 }
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
