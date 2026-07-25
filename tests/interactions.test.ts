import {
  ApplicationCommandTypes,
  CommandInteraction,
  ComponentInteraction,
  ComponentTypes,
  ModalSubmitInteraction,
  TextInputStyles
} from 'oceanic.js'
import { expect, test, vi } from 'vite-plus/test'
import { createRosepack } from '../src/index.ts'
import { ComponentRouteError, ComponentValidationError } from '../src/errors.ts'

interface TestApp {
  events: string[]
}

const rosepack = createRosepack<TestApp>()
const { button, component, messageMenu, modal, slash, userMenu } = rosepack

test('builds routed component IDs with encoded parameters', () => {
  const deleteNote = button({
    customID: 'notes/:ownerID/delete/:noteID',
    async execute() {}
  })

  expect(deleteNote.buildID({ params: { noteID: 'note/1', ownerID: 'user 1' } })).toBe(
    'notes/user%201/delete/note%2F1'
  )
})

test('rejects missing and oversized component route IDs', () => {
  const routed = button({ customID: 'notes/:noteID', async execute() {} })
  expect(() => routed.buildID({ params: {} as never })).toThrow(ComponentRouteError)

  const oversized = button({ customID: 'x'.repeat(100), async execute() {} })
  expect(() => oversized.buildID()).not.toThrow()
  const tooLong = button({ customID: 'notes/:noteID', async execute() {} })
  expect(() => tooLong.buildID({ params: { noteID: 'x'.repeat(100) } })).toThrow(
    ComponentRouteError
  )
  expect(() =>
    rosepack.createRegistry({
      components: [button({ customID: 'x'.repeat(101), async execute() {} })]
    })
  ).toThrow(ComponentValidationError)
})

test('dispatches buttons with decoded params and adaptive parent updates', async () => {
  const execute = vi.fn(async (context) => {
    context.app.events.push(`${context.params.noteID}:${context.component.componentType}`)
    await context.deferUpdate()
    await context.editParent('deleted')
  })
  const deleteNote = button({ customID: 'notes/:noteID/delete', execute })
  const registry = rosepack.createRegistry({ components: [deleteNote] })
  const interaction = createComponentInteraction('notes/note%2F1/delete', ComponentTypes.BUTTON)

  await registry.dispatch({ app: { events: [] }, interaction })

  expect(execute).toHaveBeenCalledOnce()
  expect(interaction.mocks.deferUpdate).toHaveBeenCalledOnce()
  expect(interaction.mocks.editOriginal).toHaveBeenCalledWith(
    expect.objectContaining({ content: 'deleted' })
  )
})

test('narrows select components and exposes selected values', async () => {
  const execute = vi.fn(async (context) => {
    context.app.events.push(`${context.params.noteID}:${context.values.join(',')}`)
    await context.update('saved')
  })
  const chooseColor = component({
    componentType: 'stringSelect',
    customID: 'notes/:noteID/color',
    execute
  })
  const registry = rosepack.createRegistry({ components: [chooseColor] })
  const interaction = createComponentInteraction(
    'notes/note-1/color',
    ComponentTypes.STRING_SELECT,
    ['red', 'blue']
  )
  const app = { events: [] }

  await registry.dispatch({ app, interaction })

  expect(app.events).toEqual(['note-1:red,blue'])
  expect(interaction.mocks.editParent).toHaveBeenCalledWith(
    expect.objectContaining({ content: 'saved' })
  )
})

test('forwards unknown components and permits disjoint component types on one route', async () => {
  const unknown = vi.fn(async () => undefined)
  const first = button({ customID: 'notes/action', async execute() {} })
  const second = component({
    componentType: 'stringSelect',
    customID: 'notes/action',
    async execute() {}
  })
  const registry = createRosepack<TestApp>({ onUnknownComponent: unknown }).createRegistry({
    components: [first, second]
  })

  await registry.dispatch({
    app: { events: [] },
    interaction: createComponentInteraction('notes/missing', ComponentTypes.BUTTON)
  })

  expect(unknown).toHaveBeenCalledOnce()
})

test('rejects ambiguous component routes of the same type', () => {
  const first = button({ customID: 'notes/:id', async execute() {} })
  const second = button({ customID: 'notes/:noteID', async execute() {} })

  expect(() => rosepack.createRegistry({ components: [first, second] })).toThrow(
    'ambiguous at runtime'
  )
})

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

type TestComponentInteraction = ComponentInteraction & {
  readonly mocks: {
    readonly deferUpdate: ReturnType<typeof vi.fn>
    readonly editOriginal: ReturnType<typeof vi.fn>
    readonly editParent: ReturnType<typeof vi.fn>
  }
}

function createComponentInteraction(
  customID: string,
  componentType: ComponentTypes,
  values: readonly string[] = []
): TestComponentInteraction {
  const deferUpdate = vi.fn(async () => {
    interaction.acknowledged = true
  })
  const editOriginal = vi.fn(async () => undefined)
  const editParent = vi.fn(async () => {
    interaction.acknowledged = true
  })
  const interaction = Object.assign(Object.create(ComponentInteraction.prototype), {
    acknowledged: false,
    applicationID: 'application-id',
    client: {},
    data:
      componentType === ComponentTypes.BUTTON
        ? { componentType, customID }
        : { componentType, customID, values: { raw: [...values] } },
    defer: vi.fn(async () => {
      interaction.acknowledged = true
    }),
    deferUpdate,
    editOriginal,
    editParent,
    createFollowup: vi.fn(async () => undefined),
    createMessage: vi.fn(async () => {
      interaction.acknowledged = true
    }),
    deleteOriginal: vi.fn(async () => undefined),
    isSelectMenuComponentInteraction: () => componentType !== ComponentTypes.BUTTON,
    mocks: { deferUpdate, editOriginal, editParent }
  }) as TestComponentInteraction
  return interaction
}
