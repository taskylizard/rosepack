import { pathToFileURL } from 'node:url'
import { manifestId } from './ids.ts'
import type { RosepackBuildManifest } from './types.ts'
import type { DiscoveredCommandFile } from './types.ts'

/** Generates the source behind a rosepack command virtual module. */
export function generateVirtualCommandModule(
  files: readonly string[],
  exportName:
    | 'messageContextMenus'
    | 'modals'
    | 'prefixCommands'
    | 'slashCommands'
    | 'userContextMenus'
): string {
  const imports = files.map(
    (file, index) => `import command${index} from ${JSON.stringify(pathToFileURL(file).href)}`
  )
  const names = files.map((_, index) => `command${index}`).join(', ')
  return `${imports.join('\n')}\n\nexport const ${exportName} = [${names}]\nexport default ${exportName}\n`
}

export function generateFileCommandModule(
  routes: readonly DiscoveredCommandFile[],
  exportName: 'prefixCommands' | 'slashCommands'
): string {
  const imports = routes.map(
    (route, index) =>
      `import command${index} from ${JSON.stringify(pathToFileURL(route.file).href)}`
  )
  const assembler =
    exportName === 'slashCommands' ? 'assembleSlashFileCommands' : 'assemblePrefixFileCommands'
  const entries = routes.map(
    (route, index) =>
      `{ definition: command${index}, path: ${JSON.stringify(route.path)}, role: ${JSON.stringify(route.role)}, source: ${JSON.stringify(route.file)} }`
  )
  return [
    `import { ${assembler} } from 'rosepack'`,
    ...imports,
    '',
    `export const ${exportName} = ${assembler}([${entries.join(', ')}]).commands`,
    `export default ${exportName}`,
    ''
  ].join('\n')
}

export function generateManifestModule(manifest: RosepackBuildManifest): string {
  return `export default ${JSON.stringify(manifest)}\n`
}

export function generateRegistrationCliModule(): string {
  return [
    `import manifest from ${JSON.stringify(manifestId)}`,
    `import { runRegistrationCli } from 'rosepack'`,
    `await runRegistrationCli({ payload: [...manifest.slashCommands, ...manifest.userContextMenus, ...manifest.messageContextMenus].map((command) => command.payload) })`
  ].join('\n')
}
