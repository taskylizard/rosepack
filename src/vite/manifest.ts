import { createHash } from 'node:crypto'
import { relative } from 'node:path'
import type { CreateApplicationCommandOptions } from 'oceanic.js'
import { runnerImport, type ResolvedConfig } from 'vite'
import type { SlashRootCommandDefinitionBase } from '../commands.ts'
import type { MessageContextMenuDefinition, UserContextMenuDefinition } from '../context-menus.ts'
import type { AnyModalDefinition } from '../modals.ts'
import type { PrefixCommandDefinitionBase } from '../prefix-commands.ts'
import { createPrefixCommands } from '../prefix-registry.ts'
import {
  buildInteractionRegistry,
  contextMenuToDiscord,
  slashCommandToDiscord
} from '../registry.ts'
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

export interface CommandManifestInput {
  readonly config: ResolvedConfig
  readonly messageContextMenuFiles: readonly string[]
  readonly modalFiles: readonly string[]
  readonly prefix?: ResolvedPrefixCommandDirectory
  readonly prefixFiles: readonly string[]
  readonly slashFiles: readonly string[]
  readonly userContextMenuFiles: readonly string[]
}

export async function compileCommandManifest(
  config: CommandManifestInput
): Promise<RosepackBuildManifest> {
  const inlineConfig = {
    configFile: config.config.configFile,
    mode: config.config.mode,
    root: config.config.root
  } as const
  const [slashCommands, userContextMenus, messageContextMenus, modals, prefixCommands] =
    await Promise.all([
      importDefaultDefinitions<SlashRootCommandDefinitionBase>(config.slashFiles, inlineConfig),
      importDefaultDefinitions<UserContextMenuDefinition>(
        config.userContextMenuFiles,
        inlineConfig
      ),
      importDefaultDefinitions<MessageContextMenuDefinition>(
        config.messageContextMenuFiles,
        inlineConfig
      ),
      importDefaultDefinitions<AnyModalDefinition>(config.modalFiles, inlineConfig),
      importDefaultDefinitions<PrefixCommandDefinitionBase>(config.prefixFiles, inlineConfig)
    ])

  throwOnIssues('slash', lintSlashCommandTree(slashCommands))
  validateDefinitionKinds(userContextMenus, 'user', config.userContextMenuFiles)
  validateDefinitionKinds(messageContextMenus, 'message', config.messageContextMenuFiles)
  buildInteractionRegistry({ messageContextMenus, modals, slashCommands, userContextMenus })

  if (config.prefix !== undefined) {
    const prefixScope =
      config.prefix.scope === undefined
        ? createPrefixCommands()
        : await importPrefixScope(config.prefix.scope, inlineConfig)
    throwOnIssues('prefix', prefixScope.lint(prefixCommands))
  }

  return {
    messageContextMenus: manifestCommands(
      messageContextMenus.map(contextMenuToDiscord),
      config.messageContextMenuFiles,
      config.config.root
    ),
    modals: modals.map((modal, index) => ({
      customID: modal.customID,
      source: relative(config.config.root, config.modalFiles[index]!)
    })),
    prefixCommands: config.prefixFiles.map((source) => ({
      source: relative(config.config.root, source)
    })),
    schemaVersion: 2,
    slashCommands: manifestCommands(
      slashCommands.map(slashCommandToDiscord),
      config.slashFiles,
      config.config.root
    ),
    userContextMenus: manifestCommands(
      userContextMenus.map(contextMenuToDiscord),
      config.userContextMenuFiles,
      config.config.root
    )
  }
}

export function emptyManifest(): RosepackBuildManifest {
  return {
    messageContextMenus: [],
    modals: [],
    prefixCommands: [],
    schemaVersion: 2,
    slashCommands: [],
    userContextMenus: []
  }
}

async function importDefaultDefinitions<TDefinition>(
  files: readonly string[],
  inlineConfig: Parameters<typeof runnerImport>[1]
): Promise<TDefinition[]> {
  return Promise.all(
    files.map(async (file) => {
      const imported = await runnerImport<{ default?: TDefinition }>(file, inlineConfig)
      if (imported.module.default === undefined) {
        throw new Error(`rosepack definition module ${file} must have a default export.`)
      }
      return imported.module.default
    })
  )
}

function validateDefinitionKinds(
  definitions: readonly { readonly kind?: string }[],
  expected: 'message' | 'user',
  files: readonly string[]
): void {
  for (const [index, definition] of definitions.entries()) {
    if (definition.kind !== expected) {
      throw new Error(
        `rosepack ${expected} context-menu module ${files[index]} exported a ${definition.kind ?? 'non-context-menu'} definition.`
      )
    }
  }
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

function manifestCommands(
  payloads: readonly CreateApplicationCommandOptions[],
  files: readonly string[],
  root: string
): RosepackBuildManifest['slashCommands'] {
  return payloads.map((payload, index) => ({
    hash: hashPayload(payload),
    key: `${payload.type}:${payload.name}`,
    payload,
    source: relative(root, files[index]!)
  }))
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
