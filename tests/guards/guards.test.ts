import { ComponentTypes, MessageFlags, Permission, Permissions } from 'oceanic.js'
import { expect, test, vi } from 'vite-plus/test'
import { assembleSlashFileCommands, createRosepack, slashGroup } from '../../src/index.ts'
import {
  createComponentInteraction,
  createContextMenuInteraction,
  createInteraction,
  createModalInteraction
} from '../testing.ts'

const rosepack = createRosepack<{ events: string[] }>()
const { button, guard, modal, slash, slashFile, slashSub, userMenu } = rosepack

function recordGuard(event: string) {
  return guard(({ app }) => {
    app.events.push(event)
    return guard.allow()
  })
}

function addResponseMocks<TInteraction extends { acknowledged: boolean }>(
  interaction: TInteraction
) {
  const createMessage = vi.fn(async () => {
    interaction.acknowledged = true
  })
  const editOriginal = vi.fn(async () => undefined)
  Object.assign(interaction, {
    applicationID: 'app',
    client: {},
    createMessage,
    editOriginal
  })
  return { createMessage, editOriginal, interaction }
}

test('runs slash guards in root, group, leaf order and short-circuits denials', async () => {
  const beforeExecute = vi.fn()
  const execute = vi.fn()
  const onError = vi.fn()
  const groupGuard = recordGuard('group')
  const command = slash({
    name: 'guarded',
    description: 'Guarded',
    guards: [recordGuard('root')],
    beforeExecute,
    onError,
    subcommands: {
      admin: {
        description: 'Admin',
        guards: [groupGuard],
        subcommands: {
          run: slashSub({
            description: 'Run',
            guards: [recordGuard('leaf'), guard(() => guard.deny('Nope')), recordGuard('skipped')],
            execute
          })
        }
      }
    }
  })
  const registry = rosepack.createRegistry({ slashCommands: [command] })
  const { createMessage, interaction } = addResponseMocks(createInteraction('guarded'))
  interaction.data.options.raw = [
    {
      name: 'admin',
      type: 2,
      options: [{ name: 'run', type: 1 }]
    }
  ] as never
  const app = { events: [] }

  await registry.dispatch({ app, interaction })

  expect(app.events).toEqual(['root', 'group', 'leaf'])
  expect(beforeExecute).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
  expect(onError).not.toHaveBeenCalled()
  expect(createMessage).toHaveBeenCalledWith(
    expect.objectContaining({ content: 'Nope', flags: 64 })
  )
})

test('preserves guards assembled from framework files', async () => {
  const commands = assembleSlashFileCommands<{ events: string[] }>([
    {
      definition: slashFile({
        description: 'File guarded',
        guards: [recordGuard('root')]
      }),
      path: ['file-guarded'],
      role: 'root',
      source: 'file-guarded/_command.ts'
    },
    {
      definition: slashGroup({
        description: 'Admin',
        guards: [recordGuard('group')]
      }),
      path: ['file-guarded', 'admin'],
      role: 'group',
      source: 'file-guarded/admin/_group.ts'
    },
    {
      definition: slashSub({
        description: 'Run',
        guards: [recordGuard('leaf')],
        async execute({ app }) {
          app.events.push('execute')
        }
      }),
      path: ['file-guarded', 'admin', 'run'],
      role: 'command',
      source: 'file-guarded/admin/run.ts'
    }
  ]).commands
  const registry = rosepack.createRegistry({ slashCommands: commands })
  const { interaction } = addResponseMocks(createInteraction('file-guarded'))
  interaction.data.options.raw = [
    {
      name: 'admin',
      type: 2,
      options: [{ name: 'run', type: 1 }]
    }
  ] as never
  const app = { events: [] }

  await registry.dispatch({ app, interaction })

  expect(app.events).toEqual(['root', 'group', 'leaf', 'execute'])
})

test('routes guard failures and denial response failures through onError', async () => {
  for (const failure of ['guard', 'reply'] as const) {
    const onError = vi.fn()
    const command = slash({
      name: 'failure',
      description: 'Failure',
      guards: [
        guard(() =>
          failure === 'guard' ? Promise.reject(new Error('guard failed')) : guard.deny('denied')
        )
      ],
      onError,
      async execute() {}
    })
    const { interaction } = addResponseMocks(createInteraction('failure'))
    if (failure === 'reply') {
      interaction.createMessage = vi.fn(async () => Promise.reject(new Error('reply failed')))
    }
    await rosepack.createRegistry({ slashCommands: [command] }).dispatch({
      app: { events: [] },
      interaction
    })
    expect(onError).toHaveBeenCalledOnce()
  }
})

test('runs target guards when invoking through the registry', async () => {
  const targetExecute = vi.fn()
  const target = slash({
    name: 'target',
    description: 'Target',
    guards: [guard(() => guard.deny('blocked'))],
    execute: targetExecute
  })
  const source = slash({
    name: 'source',
    description: 'Source',
    async execute(context) {
      await context.invoke(target, {})
    }
  })
  const { createMessage, interaction } = addResponseMocks(createInteraction('source'))

  await rosepack.createRegistry({ slashCommands: [source, target] }).dispatch({
    app: { events: [] },
    interaction
  })

  expect(targetExecute).not.toHaveBeenCalled()
  expect(createMessage).toHaveBeenCalledOnce()
})

test('built-ins fail closed and allow matching guild members', async () => {
  const execute = vi.fn()
  const command = slash({
    name: 'admin',
    description: 'Admin',
    guards: [guard.guild(), guard.userPermissions('MANAGE_GUILD'), guard.role('staff')],
    execute
  })
  const registry = rosepack.createRegistry({ slashCommands: [command] })
  const { interaction: denied } = addResponseMocks(createInteraction('admin'))
  await registry.dispatch({ app: { events: [] }, interaction: denied })
  expect(execute).not.toHaveBeenCalled()

  const { interaction: allowed } = addResponseMocks(createInteraction('admin'))
  Object.assign(allowed, {
    guildID: 'guild',
    member: { roles: ['staff'] },
    memberPermissions: new Permission(Permissions.MANAGE_GUILD)
  })
  await registry.dispatch({ app: { events: [] }, interaction: allowed })
  expect(execute).toHaveBeenCalledOnce()
})

test('role guards fail closed when permissions are unavailable', async () => {
  const execute = vi.fn()
  const command = slash({
    name: 'role-only',
    description: 'Role only',
    guards: [guard.role('staff')],
    execute
  })
  const { interaction } = addResponseMocks(createInteraction('role-only'))
  Object.assign(interaction, {
    guildID: 'guild',
    member: { roles: ['staff'] },
    memberPermissions: null
  })

  await rosepack.createRegistry({ slashCommands: [command] }).dispatch({
    app: { events: [] },
    interaction
  })

  expect(execute).not.toHaveBeenCalled()
})

test('preserves denial flags and explicit visibility', async () => {
  const defaultCommand = slash({
    name: 'private-denial',
    description: 'Private denial',
    guards: [guard(() => guard.deny({ content: 'Private', flags: MessageFlags.SUPPRESS_EMBEDS }))],
    async execute() {}
  })
  const publicCommand = slash({
    name: 'public-denial',
    description: 'Public denial',
    guards: [
      guard(() =>
        guard.deny({ content: 'Public', flags: MessageFlags.SUPPRESS_EMBEDS }, { ephemeral: false })
      )
    ],
    async execute() {}
  })
  const registry = rosepack.createRegistry({ slashCommands: [defaultCommand, publicCommand] })
  const privateResponse = addResponseMocks(createInteraction('private-denial'))
  const publicResponse = addResponseMocks(createInteraction('public-denial'))
  const acknowledgedResponse = addResponseMocks(createInteraction('private-denial'))
  acknowledgedResponse.interaction.acknowledged = true

  await registry.dispatch({ app: { events: [] }, interaction: privateResponse.interaction })
  await registry.dispatch({ app: { events: [] }, interaction: publicResponse.interaction })
  await registry.dispatch({ app: { events: [] }, interaction: acknowledgedResponse.interaction })

  expect(privateResponse.createMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      flags: MessageFlags.SUPPRESS_EMBEDS | MessageFlags.EPHEMERAL
    })
  )
  expect(publicResponse.createMessage).toHaveBeenCalledWith(
    expect.objectContaining({ flags: MessageFlags.SUPPRESS_EMBEDS })
  )
  expect(acknowledgedResponse.editOriginal).toHaveBeenCalledWith(
    expect.objectContaining({ flags: MessageFlags.SUPPRESS_EMBEDS })
  )
})

test('runs local component guards before lifecycle hooks', async () => {
  const beforeExecute = vi.fn()
  const execute = vi.fn()
  const component = button({
    customID: 'guarded-button',
    guards: [guard(() => guard.deny('blocked'))],
    beforeExecute,
    execute
  })
  const interaction = createComponentInteraction('guarded-button', ComponentTypes.BUTTON)

  await rosepack.createRegistry({ components: [component] }).dispatch({
    app: { events: [] },
    interaction
  })

  expect(beforeExecute).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
  expect(interaction.acknowledged).toBe(true)
})

test('runs local context-menu and modal guards', async () => {
  const menuBeforeExecute = vi.fn()
  const menuExecute = vi.fn()
  const modalBeforeExecute = vi.fn()
  const modalExecute = vi.fn()
  const menu = userMenu({
    name: 'Guarded user',
    guards: [guard(() => guard.deny('Menu blocked'))],
    beforeExecute: menuBeforeExecute,
    execute: menuExecute
  })
  const guardedModal = modal({
    customID: 'guarded-modal',
    title: 'Guarded modal',
    fields: { value: { kind: 'text', label: 'Value' } },
    guards: [guard(() => guard.deny('Modal blocked'))],
    beforeExecute: modalBeforeExecute,
    execute: modalExecute
  })
  const registry = rosepack.createRegistry({
    modals: [guardedModal],
    userContextMenus: [menu]
  })
  const menuResponse = addResponseMocks(createContextMenuInteraction('Guarded user', 'user'))
  const modalResponse = addResponseMocks(
    createModalInteraction('guarded-modal', { value: 'value' })
  )

  await registry.dispatch({ app: { events: [] }, interaction: menuResponse.interaction })
  await registry.dispatch({ app: { events: [] }, interaction: modalResponse.interaction })

  expect(menuBeforeExecute).not.toHaveBeenCalled()
  expect(menuExecute).not.toHaveBeenCalled()
  expect(modalBeforeExecute).not.toHaveBeenCalled()
  expect(modalExecute).not.toHaveBeenCalled()
  expect(menuResponse.createMessage).toHaveBeenCalledWith(
    expect.objectContaining({ content: 'Menu blocked', flags: MessageFlags.EPHEMERAL })
  )
  expect(modalResponse.createMessage).toHaveBeenCalledWith(
    expect.objectContaining({ content: 'Modal blocked', flags: MessageFlags.EPHEMERAL })
  )
})
