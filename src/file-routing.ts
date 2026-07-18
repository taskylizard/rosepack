import type {
  SlashFileGroupDefinition,
  SlashRootCommandDefinitionBase,
  SlashSubcommandDefinitionBase,
  SlashSubcommandGroupDefinition
} from './commands.ts'
import {
  isSlashFileDefinition,
  isSlashFileGroupDefinition,
  isSlashSubcommandDefinition
} from './commands.ts'
import type { PrefixCommandDefinitionBase } from './prefix-commands.ts'
import { isPrefixFileCommandDefinition } from './prefix-commands.ts'

export interface FileCommandModule<TDefinition = unknown> {
  readonly definition: TDefinition
  readonly path: readonly string[]
  readonly role: 'command' | 'group' | 'root'
  readonly source: string
}

export interface AssembledFileCommands<TCommand> {
  readonly commands: readonly TCommand[]
  readonly sources: readonly string[]
}

/** Assembles Discord's root → group → leaf tree from framework command files. */
export function assembleSlashFileCommands<TApp = unknown>(
  modules: readonly FileCommandModule[]
): AssembledFileCommands<SlashRootCommandDefinitionBase<TApp>> {
  const roots = groupByRoot(modules)
  const commands: SlashRootCommandDefinitionBase<TApp>[] = []
  const sources: string[] = []
  for (const [rootName, entries] of roots) {
    const flat = entries.find((entry) => entry.path.length === 1 && entry.role === 'command')
    const metadata = entries.find((entry) => entry.path.length === 1 && entry.role === 'root')
    if (flat !== undefined && entries.length > 1) {
      throw fileTreeError(
        flat.source,
        `/${rootName} cannot be both a file and a directory command.`
      )
    }
    if (flat !== undefined) {
      const command = nameSlashRoot(flat.definition, rootName, flat.source)
      commands.push(command as SlashRootCommandDefinitionBase<TApp>)
      sources.push(flat.source)
      continue
    }
    if (metadata === undefined) {
      throw fileTreeError(
        entries[0]!.source,
        `/${rootName} requires ${rootName}/_command.ts with its root metadata.`
      )
    }
    const root = nameSlashRoot(metadata.definition, rootName, metadata.source)
    assertNoDeclaredChildren(root, metadata.source, 'Slash root metadata')
    const subcommands: Record<
      string,
      SlashSubcommandDefinitionBase | SlashSubcommandGroupDefinition
    > = Object.create(null)
    for (const entry of entries) {
      if (entry === metadata) continue
      if (entry.path.length === 2 && entry.role === 'command') {
        subcommands[entry.path[1]!] = requireSlashLeaf(entry)
        continue
      }
      if (entry.path.length === 2 && entry.role === 'group') {
        const groupName = entry.path[1]!
        const leaves = entries.filter(
          (candidate) =>
            candidate.role === 'command' &&
            candidate.path.length === 3 &&
            candidate.path[1] === groupName
        )
        if (leaves.length === 0) {
          throw fileTreeError(entry.source, `Slash group /${rootName} ${groupName} is empty.`)
        }
        subcommands[groupName] = {
          ...requireSlashGroup(entry),
          subcommands: Object.fromEntries(
            leaves.map((leaf) => [leaf.path[2]!, requireSlashLeaf(leaf)] as const)
          )
        }
        continue
      }
      if (entry.path.length === 3 && entry.role === 'command') {
        const groupName = entry.path[1]!
        const group = entries.find(
          (candidate) =>
            candidate.role === 'group' &&
            candidate.path.length === 2 &&
            candidate.path[1] === groupName
        )
        if (group === undefined) {
          throw fileTreeError(
            entry.source,
            `/${rootName} ${groupName} requires ${rootName}/${groupName}/_group.ts.`
          )
        }
        continue
      }
      throw fileTreeError(entry.source, 'Discord slash commands support only root → group → leaf.')
    }
    if (Object.keys(subcommands).length === 0) {
      throw fileTreeError(metadata.source, `Slash command /${rootName} has no subcommands.`)
    }
    ;(root as { subcommands?: unknown }).subcommands = subcommands
    commands.push(root as SlashRootCommandDefinitionBase<TApp>)
    sources.push(metadata.source)
  }
  return { commands, sources }
}

/** Assembles an arbitrary-depth prefix tree from `_command.ts` directory nodes and leaf files. */
export function assemblePrefixFileCommands<TApp = unknown>(
  modules: readonly FileCommandModule[]
): AssembledFileCommands<PrefixCommandDefinitionBase<TApp>> {
  const byPath = new Map<string, FileCommandModule>()
  for (const module of modules) {
    const key = pathKey(module.path)
    if (byPath.has(key)) {
      throw fileTreeError(
        module.source,
        `Duplicate prefix command path "${module.path.join(' ')}".`
      )
    }
    byPath.set(key, module)
  }
  const children = new Map<string, FileCommandModule[]>()
  for (const module of modules) {
    const parent = pathKey(module.path.slice(0, -1))
    const siblings = children.get(parent) ?? []
    siblings.push(module)
    children.set(parent, siblings)
  }

  const build = (module: FileCommandModule): PrefixCommandDefinitionBase => {
    if (module.role === 'group') {
      throw fileTreeError(module.source, 'Prefix trees use `_command.ts`, not `_group.ts`.')
    }
    const definition = namePrefixCommand(module.definition, module.path.at(-1)!, module.source)
    const nested = children.get(pathKey(module.path)) ?? []
    if (nested.length > 0) {
      assertNoDeclaredChildren(definition, module.source, 'Prefix directory metadata')
      ;(definition as { subcommands?: readonly PrefixCommandDefinitionBase[] }).subcommands = nested
        .sort(compareModulePaths)
        .map(build)
    }
    return definition
  }

  for (const module of modules) {
    if (module.path.length <= 1) continue
    const parentPath = module.path.slice(0, -1)
    if (!byPath.has(pathKey(parentPath))) {
      throw fileTreeError(
        module.source,
        `Prefix directory "${parentPath.join('/')}" requires its own _command.ts.`
      )
    }
  }
  const roots = (children.get('') ?? []).sort(compareModulePaths)
  return {
    commands: roots.map(build) as PrefixCommandDefinitionBase<TApp>[],
    sources: roots.map((root) => root.source)
  }
}

function nameSlashRoot(
  value: unknown,
  name: string,
  source: string
): SlashRootCommandDefinitionBase {
  if (isSlashFileDefinition(value)) {
    ;(value as unknown as { name: string }).name = name
    return value as unknown as SlashRootCommandDefinitionBase
  }
  if (isObjectWithOptionalName(value)) {
    assertMatchingName(value, name, source)
    return value as unknown as SlashRootCommandDefinitionBase
  }
  throw fileTreeError(source, 'Expected a slash() or slashFile() default export.')
}

function namePrefixCommand(
  value: unknown,
  name: string,
  source: string
): PrefixCommandDefinitionBase {
  if (isPrefixFileCommandDefinition(value)) {
    ;(value as unknown as { name: string }).name = name
    return value as unknown as PrefixCommandDefinitionBase
  }
  if (isObjectWithOptionalName(value)) {
    assertMatchingName(value, name, source)
    return value as unknown as PrefixCommandDefinitionBase
  }
  throw fileTreeError(source, 'Expected a prefix() or prefixFile() default export.')
}

function requireSlashLeaf(module: FileCommandModule): SlashSubcommandDefinitionBase {
  const value = module.definition
  if (isSlashSubcommandDefinition(value)) {
    return value as SlashSubcommandDefinitionBase
  }
  throw fileTreeError(
    module.source,
    'Slash subcommand files must default-export slashSub({ ... }).'
  )
}

function requireSlashGroup(module: FileCommandModule): SlashFileGroupDefinition {
  const value = module.definition
  if (isSlashFileGroupDefinition(value)) {
    return value as SlashFileGroupDefinition
  }
  throw fileTreeError(module.source, 'Slash `_group.ts` must export slashGroup({ description }).')
}

function assertNoDeclaredChildren(
  value: { subcommands?: unknown },
  source: string,
  kind: string
): void {
  if (value.subcommands !== undefined) {
    throw fileTreeError(
      source,
      `${kind} cannot declare subcommands; child files define the filesystem tree.`
    )
  }
}

function groupByRoot(modules: readonly FileCommandModule[]): Map<string, FileCommandModule[]> {
  const result = new Map<string, FileCommandModule[]>()
  for (const module of [...modules].sort(compareModulePaths)) {
    const root = module.path[0]
    if (root === undefined) throw fileTreeError(module.source, 'Command path cannot be empty.')
    const entries = result.get(root) ?? []
    entries.push(module)
    result.set(root, entries)
  }
  return result
}

function isObjectWithOptionalName(value: unknown): value is { name?: unknown } {
  return typeof value === 'object' && value !== null
}

function assertMatchingName(value: { name?: unknown }, name: string, source: string): void {
  if (value.name === undefined) {
    ;(value as { name: string }).name = name
    return
  }
  if (value.name !== name) {
    throw fileTreeError(
      source,
      `Explicit name ${JSON.stringify(value.name)} must match filename-derived name "${name}".`
    )
  }
}

function compareModulePaths(left: FileCommandModule, right: FileCommandModule): number {
  return left.path.join('/').localeCompare(right.path.join('/'))
}

function pathKey(path: readonly string[]): string {
  return path.join('\0')
}

function fileTreeError(source: string, message: string): Error {
  return new Error(`rosepack filesystem command error in ${source}: ${message}`)
}
