import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import type { RosepackBuildManifest } from './types.ts'
import type { DiscoveredCommandFile } from './types.ts'

export interface RosepackTypegenInput {
  readonly manifest: RosepackBuildManifest
  readonly messageContextMenuFiles: readonly string[]
  readonly modalFiles: readonly string[]
  readonly outputDirectory?: string
  readonly prefixFiles: readonly string[]
  readonly prefixRoutes: readonly DiscoveredCommandFile[]
  readonly root: string
  readonly slashFiles: readonly string[]
  readonly slashRoutes: readonly DiscoveredCommandFile[]
  readonly userContextMenuFiles: readonly string[]
}

export async function generateRosepackTypes(input: RosepackTypegenInput): Promise<void> {
  const outputDirectory = resolve(input.root, input.outputDirectory ?? '.rosepack')
  await mkdir(outputDirectory, { recursive: true })
  const declarations = generateDeclarations(input, outputDirectory)
  const modalCatalog = generateModalCatalogDeclaration(input, outputDirectory)
  const tsconfig = {
    compilerOptions: {
      paths: {
        '#rosepack/*': ['./*']
      }
    },
    include: ['../src/**/*.ts', '../tests/**/*.ts', '../vite.config.ts', './**/*.d.ts']
  }
  await Promise.all([
    writeIfChanged(
      resolve(outputDirectory, 'env.d.ts'),
      "import './modals.d.ts'\nimport './virtual-modules.d.ts'\n"
    ),
    writeIfChanged(resolve(outputDirectory, 'modals.d.ts'), modalCatalog),
    writeIfChanged(resolve(outputDirectory, 'virtual-modules.d.ts'), declarations),
    writeIfChanged(
      resolve(outputDirectory, 'tsconfig.json'),
      `${JSON.stringify(tsconfig, undefined, 2)}\n`
    )
  ])
}

export function generateDeclarations(
  input: RosepackTypegenInput,
  outputDirectory = resolve(input.root, input.outputDirectory ?? '.rosepack')
): string {
  const modules = [
    slashFileVirtualDeclaration(
      'virtual:rosepack/slash-commands',
      'slashCommands',
      input.slashRoutes,
      outputDirectory
    ),
    virtualDeclaration(
      'virtual:rosepack/user-context-menus',
      'userContextMenus',
      input.userContextMenuFiles,
      outputDirectory
    ),
    virtualDeclaration(
      'virtual:rosepack/message-context-menus',
      'messageContextMenus',
      input.messageContextMenuFiles,
      outputDirectory
    ),
    virtualDeclaration('virtual:rosepack/modals', 'modals', input.modalFiles, outputDirectory),
    prefixFileVirtualDeclaration(
      'virtual:rosepack/prefix-commands',
      'prefixCommands',
      input.prefixRoutes,
      outputDirectory
    )
  ]
  return modules.join('\n')
}

function slashFileVirtualDeclaration(
  id: string,
  exportName: string,
  routes: readonly DiscoveredCommandFile[],
  outputDirectory: string
): string {
  const roots = [...new Set(routes.map((route) => route.path[0]!))]
  const elements = roots.map((root) => slashRootType(root, routes, outputDirectory))
  return virtualTupleDeclaration(id, exportName, elements)
}

function slashRootType(
  root: string,
  routes: readonly DiscoveredCommandFile[],
  outputDirectory: string
): string {
  const entries = routes.filter((route) => route.path[0] === root)
  const flat = entries.find((route) => route.path.length === 1 && route.role === 'command')
  if (flat !== undefined) return namedDefinitionType(flat, root, outputDirectory)
  const metadata = entries.find((route) => route.path.length === 1 && route.role === 'root')
  if (metadata === undefined) return "import('rosepack').SlashRootCommandDefinitionBase"
  const direct = entries.filter((route) => route.path.length === 2 && route.role === 'command')
  const groups = entries.filter((route) => route.path.length === 2 && route.role === 'group')
  const children = [
    ...direct.map(
      (route) =>
        `${JSON.stringify(route.path[1])}: typeof import(${JSON.stringify(typeImportSpecifier(outputDirectory, route.file))}).default`
    ),
    ...groups.map((group) => {
      const leaves = entries.filter(
        (route) =>
          route.role === 'command' && route.path.length === 3 && route.path[1] === group.path[1]
      )
      const leafTypes = leaves
        .map(
          (leaf) =>
            `${JSON.stringify(leaf.path[2])}: typeof import(${JSON.stringify(typeImportSpecifier(outputDirectory, leaf.file))}).default`
        )
        .join('; ')
      return `${JSON.stringify(group.path[1])}: Omit<typeof import(${JSON.stringify(typeImportSpecifier(outputDirectory, group.file))}).default, 'subcommands'> & { readonly subcommands: { ${leafTypes} } }`
    })
  ].join('; ')
  const metadataType = `typeof import(${JSON.stringify(typeImportSpecifier(outputDirectory, metadata.file))}).default`
  return `Omit<${metadataType}, 'name' | 'subcommands'> & { readonly name: ${JSON.stringify(root)}; readonly subcommands: { ${children} } }`
}

function prefixFileVirtualDeclaration(
  id: string,
  exportName: string,
  routes: readonly DiscoveredCommandFile[],
  outputDirectory: string
): string {
  const roots = routes.filter((route) => route.path.length === 1)
  const elements = roots.map((root) => prefixRouteType(root, routes, outputDirectory))
  return virtualTupleDeclaration(id, exportName, elements)
}

function prefixRouteType(
  route: DiscoveredCommandFile,
  routes: readonly DiscoveredCommandFile[],
  outputDirectory: string
): string {
  const name = route.path.at(-1)!
  const children = routes.filter(
    (candidate) =>
      candidate.path.length === route.path.length + 1 &&
      candidate.path.slice(0, -1).every((segment, index) => segment === route.path[index])
  )
  const base = namedDefinitionType(route, name, outputDirectory)
  if (children.length === 0) return base
  const nested = children.map((child) => prefixRouteType(child, routes, outputDirectory)).join(', ')
  return `Omit<${base}, 'subcommands'> & { readonly subcommands: readonly [${nested}] }`
}

function namedDefinitionType(
  route: DiscoveredCommandFile,
  name: string,
  outputDirectory: string
): string {
  const imported = `typeof import(${JSON.stringify(typeImportSpecifier(outputDirectory, route.file))}).default`
  return `Omit<${imported}, 'name'> & { readonly name: ${JSON.stringify(name)} }`
}

function virtualTupleDeclaration(
  id: string,
  exportName: string,
  elements: readonly string[]
): string {
  const tuple =
    elements.length === 0 ? 'readonly []' : `readonly [\n    ${elements.join(',\n    ')}\n  ]`
  return [
    `declare module ${JSON.stringify(id)} {`,
    `  const ${exportName}: ${tuple}`,
    `  export { ${exportName} }`,
    `  export default ${exportName}`,
    '}',
    ''
  ].join('\n')
}

function generateModalCatalogDeclaration(
  input: RosepackTypegenInput,
  outputDirectory: string
): string {
  const modalCatalog = input.manifest.modals
    .map((modal, index) => {
      const specifier = typeImportSpecifier(outputDirectory, input.modalFiles[index]!)
      return `    ${JSON.stringify(modal.customID)}: typeof import(${JSON.stringify(specifier)}).default`
    })
    .join('\n')
  return [
    "import 'rosepack'",
    '',
    "declare module 'rosepack' {",
    '  interface RosepackGeneratedModalCatalog {',
    modalCatalog,
    '  }',
    '}',
    ''
  ].join('\n')
}

function virtualDeclaration(
  id: string,
  exportName: string,
  files: readonly string[],
  outputDirectory: string
): string {
  const elements = files.map(
    (file) =>
      `    typeof import(${JSON.stringify(typeImportSpecifier(outputDirectory, file))}).default`
  )
  const tuple = elements.length === 0 ? 'readonly []' : `readonly [\n${elements.join(',\n')}\n  ]`
  return [
    `declare module ${JSON.stringify(id)} {`,
    `  const ${exportName}: ${tuple}`,
    `  export { ${exportName} }`,
    `  export default ${exportName}`,
    '}',
    ''
  ].join('\n')
}

function typeImportSpecifier(fromDirectory: string, file: string): string {
  const path = relative(fromDirectory, file).split(sep).join('/')
  return path.startsWith('.') ? path : `./${path}`
}

async function writeIfChanged(file: string, content: string): Promise<void> {
  try {
    if ((await readFile(file, 'utf8')) === content) return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, content)
}
