import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vite-plus/test'
import { discoverCommandModules, generateVirtualCommandModule } from '../src/vite.ts'

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
    'commands'
  )

  expect(source).toContain('import command0 from "file:///commands/ping.ts"')
  expect(source).toContain('import command1 from "file:///commands/notes.ts"')
  expect(source).toContain('export const commands = [command0, command1]')
  expect(source).toContain('export default commands')
})

test('generates the prefix command virtual module', () => {
  const source = generateVirtualCommandModule(['/prefix/echo.ts'], 'prefixCommands')

  expect(source).toContain('export const prefixCommands = [command0]')
  expect(source).toContain('export default prefixCommands')
})
