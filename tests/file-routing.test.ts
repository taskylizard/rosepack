import { expect, test } from 'vite-plus/test'
import {
  assemblePrefixFileCommands,
  assembleSlashFileCommands,
  createRosepack,
  slashGroup
} from '../src/index.ts'

test('assembles flat and nested slash filesystem commands', () => {
  const rosepack = createRosepack<{}>()
  const ping = rosepack.slashFile({ description: 'Ping', async execute() {} })
  const admin = rosepack.slashFile({ description: 'Administration' })
  const inspect = rosepack.slashSub({ description: 'Inspect', async execute() {} })
  const assembled = assembleSlashFileCommands<{}>([
    { definition: ping, path: ['ping'], role: 'command', source: 'ping.ts' },
    { definition: admin, path: ['admin'], role: 'root', source: 'admin/_command.ts' },
    {
      definition: slashGroup({ description: 'Server actions' }),
      path: ['admin', 'server'],
      role: 'group',
      source: 'admin/server/_group.ts'
    },
    {
      definition: inspect,
      path: ['admin', 'server', 'inspect'],
      role: 'command',
      source: 'admin/server/inspect.ts'
    }
  ])
  const registry = rosepack.createCompiledRegistry({ slashCommands: assembled.commands })

  expect(assembled.commands.map((command) => command.name)).toEqual(['admin', 'ping'])
  expect(registry.resolve('/admin server inspect')?.definition).toBe(inspect)
  expect(registry.resolve('/ping')?.definition).toBe(ping)
})

test('assembles arbitrary-depth prefix filesystem commands', () => {
  const rosepack = createRosepack<{}>()
  const prefixCommands = rosepack.createPrefixCommands()
  const root = prefixCommands.prefixFile({ description: 'Admin' })
  const users = prefixCommands.prefixFile({ description: 'Users' })
  const ban = prefixCommands.prefixFile({
    description: 'Ban',
    options: '[reason?: rest]',
    async execute() {}
  })
  const assembled = assemblePrefixFileCommands<{}>([
    { definition: root, path: ['admin'], role: 'command', source: 'admin/_command.ts' },
    {
      definition: users,
      path: ['admin', 'users'],
      role: 'command',
      source: 'admin/users/_command.ts'
    },
    {
      definition: ban,
      path: ['admin', 'users', 'ban'],
      role: 'command',
      source: 'admin/users/ban.ts'
    }
  ])
  const registry = prefixCommands.createCompiledRegistry(assembled.commands, { prefixes: '!' })

  expect(registry.resolve('admin users ban')?.definition).toBe(ban)
  expect(registry.resolve('admin users')?.children[0]?.name).toBe('ban')
})

test('rejects explicit names that drift from framework filenames', () => {
  const rosepack = createRosepack<{}>()
  const command = rosepack.slash({ name: 'pong', description: 'Ping', async execute() {} })

  expect(() =>
    assembleSlashFileCommands([
      { definition: command, path: ['ping'], role: 'command', source: 'ping.ts' }
    ])
  ).toThrow('must match filename-derived name "ping"')
})

test('requires slash root and group metadata files', () => {
  const rosepack = createRosepack<{}>()
  const leaf = rosepack.slashSub({ description: 'Leaf', async execute() {} })

  expect(() =>
    assembleSlashFileCommands([
      { definition: leaf, path: ['admin', 'inspect'], role: 'command', source: 'admin/inspect.ts' }
    ])
  ).toThrow('requires admin/_command.ts')
  expect(() =>
    assembleSlashFileCommands([
      {
        definition: rosepack.slashFile({ description: 'Admin' }),
        path: ['admin'],
        role: 'root',
        source: 'admin/_command.ts'
      },
      {
        definition: leaf,
        path: ['admin', 'server', 'inspect'],
        role: 'command',
        source: 'admin/server/inspect.ts'
      }
    ])
  ).toThrow('requires admin/server/_group.ts')
})

test('requires filesystem-specific slash helpers', () => {
  const rosepack = createRosepack<{}>()
  const root = rosepack.slashFile({ description: 'Admin' })

  expect(() =>
    assembleSlashFileCommands([
      { definition: root, path: ['admin'], role: 'root', source: 'admin/_command.ts' },
      {
        definition: { description: 'Inspect', async execute() {} },
        path: ['admin', 'inspect'],
        role: 'command',
        source: 'admin/inspect.ts'
      }
    ])
  ).toThrow('must default-export slashSub')

  expect(() =>
    assembleSlashFileCommands([
      { definition: root, path: ['admin'], role: 'root', source: 'admin/_command.ts' },
      {
        definition: { description: 'Server' },
        path: ['admin', 'server'],
        role: 'group',
        source: 'admin/server/_group.ts'
      },
      {
        definition: rosepack.slashSub({ description: 'Inspect', async execute() {} }),
        path: ['admin', 'server', 'inspect'],
        role: 'command',
        source: 'admin/server/inspect.ts'
      }
    ])
  ).toThrow('must export slashGroup')
})

test('rejects manually declared children in filesystem metadata', () => {
  const rosepack = createRosepack<{}>()
  const leaf = rosepack.slashSub({ description: 'Inspect', async execute() {} })
  const legacyRoot = rosepack.slash({
    name: 'admin',
    description: 'Admin',
    subcommands: { inspect: leaf }
  })

  expect(() =>
    assembleSlashFileCommands([
      {
        definition: legacyRoot,
        path: ['admin'],
        role: 'root',
        source: 'admin/_command.ts'
      },
      {
        definition: leaf,
        path: ['admin', 'inspect'],
        role: 'command',
        source: 'admin/inspect.ts'
      }
    ])
  ).toThrow('cannot declare subcommands')

  const prefixCommands = rosepack.createPrefixCommands()
  const legacyPrefix = prefixCommands.prefix({
    name: 'admin',
    subcommands: [prefixCommands.prefix({ name: 'inspect', async execute() {} })]
  })
  expect(() =>
    assemblePrefixFileCommands([
      {
        definition: legacyPrefix,
        path: ['admin'],
        role: 'command',
        source: 'admin/_command.ts'
      },
      {
        definition: prefixCommands.prefixFile({ async execute() {} }),
        path: ['admin', 'inspect'],
        role: 'command',
        source: 'admin/inspect.ts'
      }
    ])
  ).toThrow('cannot declare subcommands')
})
