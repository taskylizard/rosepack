import { readdir } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import type {
  DiscoveredCommandFile,
  ResolvedCommandDirectory,
  ResolvedPrefixCommandDirectory,
  RosepackCommandDirectoryOptions,
  RosepackPrefixCommandDirectoryOptions
} from './types.ts'
import { resolveFromRoot } from './paths.ts'

const commandExtensions = new Set(['.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])

/** Recursively returns command modules in deterministic path order. */
export async function discoverCommandModules(
  options: RosepackCommandDirectoryOptions
): Promise<readonly string[]> {
  const directory = resolve(options.directory)
  const files = await walkDirectory(directory)
  const exclude = options.exclude ?? []
  return files
    .filter(isCommandModule)
    .filter((file) => !isIndexModule(file))
    .filter((file) => !exclude.some((pattern) => pattern.test(relative(directory, file))))
    .sort((left, right) => left.localeCompare(right))
}

export async function discoverFileCommandModules(
  options: RosepackCommandDirectoryOptions,
  kind: 'prefix' | 'slash'
): Promise<readonly DiscoveredCommandFile[]> {
  const files = await discoverCommandModules(options)
  const directory = resolve(options.directory)
  return files.map((file) => {
    const relativeFile = relative(directory, file)
    const parts = relativeFile.split(sep)
    const filename = parts.pop()!
    const stem = stripCommandExtension(filename)
    const role =
      stem === '_command'
        ? kind === 'slash'
          ? 'root'
          : 'command'
        : stem === '_group'
          ? 'group'
          : 'command'
    const path = stem === '_command' || stem === '_group' ? parts : [...parts, stem]
    if (path.length === 0) {
      throw new Error(`rosepack filesystem command file ${file} has no derived command path.`)
    }
    for (const segment of path) validateFileCommandSegment(segment, file, kind)
    if (kind === 'slash' && path.length > 3) {
      throw new Error(
        `rosepack slash command file ${file} exceeds Discord's root → group → leaf depth.`
      )
    }
    if (kind === 'slash' && role === 'group' && path.length !== 2) {
      throw new Error(`rosepack slash group file ${file} must be one directory below a root.`)
    }
    return { file, path, role }
  })
}

export function resolveCommandDirectory(
  root: string,
  option: false | RosepackCommandDirectoryOptions | undefined,
  defaultDirectory: string
): ResolvedCommandDirectory | undefined {
  if (option === false) return undefined
  return {
    directory: resolveFromRoot(root, option?.directory ?? defaultDirectory),
    exclude: option?.exclude ?? []
  }
}

export function resolvePrefixCommandDirectory(
  root: string,
  option: false | RosepackPrefixCommandDirectoryOptions | undefined,
  defaultDirectory: string
): ResolvedPrefixCommandDirectory | undefined {
  const directory = resolveCommandDirectory(root, option, defaultDirectory)
  if (directory === undefined) return undefined
  return {
    ...directory,
    scope:
      option === false || option === undefined || option.scope === undefined
        ? undefined
        : resolveFromRoot(root, option.scope)
  }
}

async function walkDirectory(directory: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name)
      return entry.isDirectory() ? walkDirectory(path) : [path]
    })
  )
  return nested.flat()
}

function isCommandModule(file: string): boolean {
  if (file.endsWith('.d.ts')) return false
  const dot = file.lastIndexOf('.')
  return dot >= 0 && commandExtensions.has(file.slice(dot))
}

function isIndexModule(file: string): boolean {
  return /(?:^|[/\\])index\.(?:[cm]?[jt]sx?)$/u.test(file)
}

function stripCommandExtension(filename: string): string {
  return filename.replace(/\.(?:[cm]?[jt]sx?)$/u, '')
}

function validateFileCommandSegment(segment: string, file: string, kind: 'prefix' | 'slash'): void {
  if (segment === '' || /\s/u.test(segment)) {
    throw new Error(`rosepack ${kind} command filename ${file} contains an invalid path segment.`)
  }
  if (kind === 'slash') {
    if (segment !== segment.toLowerCase()) {
      throw new Error(
        `rosepack slash command filename ${file} must use lowercase command path segments.`
      )
    }
    if (!/^[-_\p{Ll}\p{Lm}\p{Lo}\p{N}]+$/u.test(segment)) {
      throw new Error(`rosepack slash command filename ${file} contains unsupported characters.`)
    }
  }
}
