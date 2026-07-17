import { createHash } from 'node:crypto'
import { relative } from 'node:path'
import type { CreateApplicationCommandOptions } from 'oceanic.js'
import { runnerImport, type ResolvedConfig } from 'vite'
import type { PrefixCommandDefinitionBase } from '../prefix-commands.ts'
import { createPrefixCommands } from '../prefix-registry.ts'
import type { SlashRootCommandDefinitionBase } from '../commands.ts'
import { slashCommandToDiscord } from '../registry.ts'
import { lintSlashCommandTree } from '../validation.ts'
import type { ResolvedPrefixCommandDirectory, RosepackBuildManifest } from './types.ts'

interface PrefixScopeModule {
  readonly prefixCommands?: {
    lint(commands: readonly PrefixCommandDefinitionBase[]): readonly ValidationIssue[]
  }
}

interface ValidationIssue {
  readonly message: string
  readonly path: readonly string[]
}

export async function compileCommandManifest(config: {
  readonly config: ResolvedConfig
  readonly prefix?: ResolvedPrefixCommandDirectory
  readonly prefixFiles: readonly string[]
  readonly slashFiles: readonly string[]
}): Promise<RosepackBuildManifest> {
  const inlineConfig = {
    configFile: config.config.configFile,
    mode: config.config.mode,
    root: config.config.root
  } as const
  const [slashCommands, prefixCommands] = await Promise.all([
    importDefaultCommands<SlashRootCommandDefinitionBase>(config.slashFiles, inlineConfig),
    importDefaultCommands<PrefixCommandDefinitionBase>(config.prefixFiles, inlineConfig)
  ])
  throwOnIssues('slash', lintSlashCommandTree(slashCommands))
  const prefixScope =
    config.prefix?.scope === undefined
      ? createPrefixCommands()
      : await importPrefixScope(config.prefix.scope, inlineConfig)
  throwOnIssues('prefix', prefixScope.lint(prefixCommands))

  return {
    prefixCommands: config.prefixFiles.map((source) => ({
      source: relative(config.config.root, source)
    })),
    schemaVersion: 1,
    slashCommands: slashCommands.map((command, index) => {
      const payload = slashCommandToDiscord(command)
      return {
        hash: hashPayload(payload),
        key: `${payload.type}:${payload.name}`,
        payload,
        source: relative(config.config.root, config.slashFiles[index]!)
      }
    })
  }
}

export function emptyManifest(): RosepackBuildManifest {
  return { prefixCommands: [], schemaVersion: 1, slashCommands: [] }
}

async function importDefaultCommands<TCommand>(
  files: readonly string[],
  inlineConfig: Parameters<typeof runnerImport>[1]
): Promise<TCommand[]> {
  return Promise.all(
    files.map(async (file) => {
      const imported = await runnerImport<{ default?: TCommand }>(file, inlineConfig)
      if (imported.module.default === undefined) {
        throw new Error(`rosepack command module ${file} must have a default export.`)
      }
      return imported.module.default
    })
  )
}

async function importPrefixScope(
  scope: string,
  inlineConfig: Parameters<typeof runnerImport>[1]
): Promise<NonNullable<PrefixScopeModule['prefixCommands']>> {
  const imported = await runnerImport<PrefixScopeModule>(scope, inlineConfig)
  if (imported.module.prefixCommands === undefined) {
    throw new Error(`rosepack prefix scope ${scope} must export \`prefixCommands\`.`)
  }
  return imported.module.prefixCommands
}

function throwOnIssues(kind: 'prefix' | 'slash', issues: readonly ValidationIssue[]): void {
  if (issues.length === 0) return
  const details = issues
    .map(
      (issue) => `- ${issue.path.length === 0 ? '<root>' : issue.path.join('.')}: ${issue.message}`
    )
    .join('\n')
  throw new Error(`rosepack ${kind} command validation failed:\n\n${details}`)
}

function hashPayload(payload: CreateApplicationCommandOptions): string {
  return `sha256:${createHash('sha256').update(stableSerialize(payload)).digest('hex')}`
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
