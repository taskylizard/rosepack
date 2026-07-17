import { pathToFileURL } from 'node:url'
import { manifestId } from './ids.ts'
import type { RosepackBuildManifest } from './types.ts'

/** Generates the source behind a rosepack command virtual module. */
export function generateVirtualCommandModule(
  files: readonly string[],
  exportName: 'commands' | 'prefixCommands'
): string {
  const imports = files.map(
    (file, index) => `import command${index} from ${JSON.stringify(pathToFileURL(file).href)}`
  )
  const names = files.map((_, index) => `command${index}`).join(', ')
  return `${imports.join('\n')}\n\nexport const ${exportName} = [${names}]\nexport default ${exportName}\n`
}

export function generateManifestModule(manifest: RosepackBuildManifest): string {
  return `export default ${JSON.stringify(manifest)}\n`
}

export function generateRegistrationCliModule(): string {
  return [
    `import manifest from ${JSON.stringify(manifestId)}`,
    `import { runRegistrationCli } from 'rosepack'`,
    `await runRegistrationCli({ payload: manifest.slashCommands.map((command) => command.payload) })`
  ].join('\n')
}
