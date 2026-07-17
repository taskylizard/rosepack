import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vite-plus/test'
import {
  discoverCommandModules,
  generateDeclarations,
  generateVirtualCommandModule
} from '../src/vite.ts'

test('discovers slash and prefix command modules recursively in stable order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rosepack-vite-'))
  await mkdir(join(root, 'nested'))
  await Promise.all([
    writeFile(join(root, 'z.ts'), 'export default {}'),
    writeFile(join(root, 'a.ts'), 'export default {}'),
    writeFile(join(root, 'index.ts'), 'export const commands = []'),
    writeFile(join(root, 'types.d.ts'), 'export interface Command {}'),
    writeFile(join(root, 'nested', 'b.mts'), 'export default {}'),
    writeFile(join(root, 'nested', 'ignored.ts'), 'export default {}')
  ])

  const files = await discoverCommandModules({
    directory: root,
    exclude: [/nested[/\\]ignored\.ts$/u]
  })

  expect(files.map((file) => file.slice(root.length + 1))).toEqual(['a.ts', 'nested/b.mts', 'z.ts'])
})

test('generates a default-exported command tuple without an index module', () => {
  const source = generateVirtualCommandModule(
    ['/commands/ping.ts', '/commands/notes.ts'],
    'slashCommands'
  )

  expect(source).toContain('import command0 from "file:///commands/ping.ts"')
  expect(source).toContain('import command1 from "file:///commands/notes.ts"')
  expect(source).toContain('export const slashCommands = [command0, command1]')
  expect(source).toContain('export default slashCommands')
})

test('generates the prefix command virtual module', () => {
  const source = generateVirtualCommandModule(['/prefix/echo.ts'], 'prefixCommands')

  expect(source).toContain('export const prefixCommands = [command0]')
  expect(source).toContain('export default prefixCommands')
})

test('generates exact virtual tuples for every framework interaction collection', () => {
  const source = generateDeclarations(
    {
      manifest: {
        messageContextMenus: [],
        modals: [{ customID: 'notes.edit/:noteID', source: 'src/modals/edit.ts' }],
        prefixCommands: [],
        schemaVersion: 2,
        slashCommands: [],
        userContextMenus: []
      },
      messageContextMenuFiles: ['/app/src/message-context-menus/quote.ts'],
      modalFiles: ['/app/src/modals/edit.ts'],
      prefixFiles: ['/app/src/prefix-commands/echo.ts'],
      root: '/app',
      slashFiles: ['/app/src/slash-commands/ping.ts'],
      userContextMenuFiles: ['/app/src/user-context-menus/inspect.ts']
    },
    '/app/.rosepack'
  )

  expect(source).toContain('declare module "virtual:rosepack/slash-commands"')
  expect(source).toContain('typeof import("../src/slash-commands/ping.ts").default')
  expect(source).toContain('declare module "virtual:rosepack/user-context-menus"')
  expect(source).toContain('declare module "virtual:rosepack/message-context-menus"')
  expect(source).toContain('declare module "virtual:rosepack/modals"')
  expect(source).toContain('declare module "virtual:rosepack/prefix-commands"')
})
