import { readdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import type {
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
