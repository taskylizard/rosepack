import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import type { RosepackBuildManifest } from './types.ts'

export interface RosepackTypegenInput {
  readonly manifest: RosepackBuildManifest
  readonly messageContextMenuFiles: readonly string[]
  readonly modalFiles: readonly string[]
  readonly outputDirectory?: string
  readonly prefixFiles: readonly string[]
  readonly root: string
  readonly slashFiles: readonly string[]
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
    virtualDeclaration(
      'virtual:rosepack/slash-commands',
      'slashCommands',
      input.slashFiles,
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
    virtualDeclaration(
      'virtual:rosepack/prefix-commands',
      'prefixCommands',
      input.prefixFiles,
      outputDirectory
    )
  ]
  return modules.join('\n')
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
