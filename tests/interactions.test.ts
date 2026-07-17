import {
  ApplicationCommandTypes,
  CommandInteraction,
  ComponentTypes,
  ModalSubmitInteraction,
  TextInputStyles
} from 'oceanic.js'
import { expect, test, vi } from 'vite-plus/test'
import { createRosepack } from '../src/index.ts'

interface TestApp {
  events: string[]
}

const rosepack = createRosepack<TestApp>()
const { messageMenu, modal, slash, userMenu } = rosepack

test('registers and dispatches user and message context menus with narrowed targets', async () => {
  const userExecute = vi.fn(async (context) => {
    context.app.events.push(`user:${context.target.id}`)
  })
  const messageExecute = vi.fn(async (context) => {
    context.app.events.push(`message:${context.target.id}`)
  })
  const inspectUser = userMenu({ name: 'Inspect user', execute: userExecute })
  const quoteMessage = messageMenu({ name: 'Quote message', execute: messageExecute })
  const registry = rosepack.createRegistry({
    messageContextMenus: [quoteMessage],
    userContextMenus: [inspectUser]
  })
  const app = { events: [] }

  expect(registry.payload).toEqual([
    { name: 'Inspect user', type: ApplicationCommandTypes.USER },
    { name: 'Quote message', type: ApplicationCommandTypes.MESSAGE }
  ])

  await registry.dispatch({
    app,
    interaction: createContextMenuInteraction('Inspect user', 'user', { id: 'user-1' })
  })
  await registry.dispatch({
    app,
    interaction: createContextMenuInteraction('Quote message', 'message', { id: 'message-1' })
  })

  expect(app.events).toEqual(['user:user-1', 'message:message-1'])
})

test('builds modern Discord modal components with typed route parameters and values', () => {
  const editModal = modal({
    customID: 'notes/:ownerID/edit/:noteID',
    title: 'Edit note',
    fields: {
      content: {
        kind: 'text',
        label: 'Content',
        required: true,
        style: 'paragraph'
      }
    },
    async execute() {}
  })

  expect(
    editModal.build({
      params: { noteID: 'note/1', ownerID: 'user 1' },
      values: { content: 'Existing content' }
    })
  ).toEqual({
    components: [
      {
        component: {
          customID: 'content',
          maxLength: undefined,
          minLength: undefined,
          placeholder: undefined,
          required: true,
          style: TextInputStyles.PARAGRAPH,
          type: ComponentTypes.TEXT_INPUT,
          value: 'Existing content'
        },
        description: undefined,
        label: 'Content',
        type: ComponentTypes.LABEL
      }
    ],
    customID: 'notes/user%201/edit/note%2F1',
    title: 'Edit note'
  })
})

test('routes modal submissions and extracts typed values and decoded parameters', async () => {
  const execute = vi.fn(async (context) => {
    context.app.events.push(
      `${context.params.noteID}:${context.values.title}:${context.values.content ?? 'none'}`
    )
  })
  const editModal = modal({
    customID: 'notes.edit/:noteID',
    title: 'Edit note',
    fields: {
      content: { kind: 'text', label: 'Content' },
      title: { kind: 'text', label: 'Title', required: true }
    },
    execute
  })
  const registry = rosepack.createRegistry({ modals: [editModal] })
  const app = { events: [] }

  await registry.dispatch({
    app,
    interaction: createModalInteraction('notes.edit/note%2F1', {
      content: 'Body',
      title: 'Hello'
    })
  })

  expect(app.events).toEqual(['note/1:Hello:Body'])
  expect(execute).toHaveBeenCalledOnce()
})

test('opens a registered modal from slash contexts by definition or generated route string', async () => {
  const feedback = modal({
    customID: 'feedback/:source',
    title: 'Feedback',
    fields: { body: { kind: 'text', label: 'Body', required: true } },
    async execute() {}
  })
  const createModal = vi.fn(async () => undefined)
  const command = slash({
    name: 'feedback',
    description: 'Feedback',
    async execute(context) {
      await context.showModal(feedback, { params: { source: 'slash' } })
    }
  })
  const registry = rosepack.createRegistry({ modals: [feedback], slashCommands: [command] })
  const interaction = createSlashInteraction('feedback', createModal)

  await registry.dispatch({ app: { events: [] }, interaction })

  expect(createModal).toHaveBeenCalledWith(
    expect.objectContaining({ customID: 'feedback/slash', title: 'Feedback' })
  )
})

test('rejects ambiguous modal routes', () => {
  const first = modal({
    customID: 'notes/:id',
    fields: { value: { kind: 'text', label: 'Value' } },
    title: 'First',
    async execute() {}
  })
  const second = modal({
    customID: 'notes/:noteID',
    fields: { value: { kind: 'text', label: 'Value' } },
    title: 'Second',
    async execute() {}
  })

  expect(() => rosepack.createRegistry({ modals: [first, second] })).toThrow('ambiguous at runtime')
})

function createContextMenuInteraction(
  name: string,
  kind: 'message' | 'user',
  target: object
): CommandInteraction {
  return Object.assign(Object.create(CommandInteraction.prototype), {
    acknowledged: false,
    data: { name, target },
    isChatInputCommand: () => false,
    isMessageCommand: () => kind === 'message',
    isUserCommand: () => kind === 'user'
  }) as CommandInteraction
}

function createModalInteraction(
  customID: string,
  values: Readonly<Record<string, string>>
): ModalSubmitInteraction {
  return Object.assign(Object.create(ModalSubmitInteraction.prototype), {
    acknowledged: false,
    data: {
      components: {
        getTextInput: (name: string) => values[name]
      },
      customID
    }
  }) as ModalSubmitInteraction
}

function createSlashInteraction(
  name: string,
  createModal: (data: unknown) => Promise<unknown>
): CommandInteraction {
  return Object.assign(Object.create(CommandInteraction.prototype), {
    acknowledged: false,
    createModal,
    data: { name, options: { raw: [] } },
    isChatInputCommand: () => true,
    isMessageCommand: () => false,
    isUserCommand: () => false
  }) as CommandInteraction
}
