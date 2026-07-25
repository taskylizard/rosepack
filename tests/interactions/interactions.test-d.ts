import { expectTypeOf, test } from 'vite-plus/test'
import {
  createRosepack,
  type ComponentBuildOptions,
  type ComponentRouteParams,
  type ModalBuildOptions,
  type ModalRouteParams
} from '../../src/index.ts'

interface TestApp {
  service: 'test'
}

const { button, component, messageMenu, modal, userMenu } = createRosepack<TestApp>()

const deleteNote = button({
  customID: 'notes/:ownerID/delete/:noteID',
  async execute(context) {
    expectTypeOf(context.params).toEqualTypeOf<{ ownerID: string; noteID: string }>()
    expectTypeOf(context.values).toEqualTypeOf<never>()
    expectTypeOf(context.interaction.data.customID).toBeString()
  }
})

const chooseColor = component({
  componentType: 'stringSelect',
  customID: 'notes/:noteID/color',
  async execute(context) {
    expectTypeOf(context.params).toEqualTypeOf<{ noteID: string }>()
    expectTypeOf(context.values).toEqualTypeOf<readonly string[]>()
    expectTypeOf(context.interaction.data.values.raw).toEqualTypeOf<string[]>()
  }
})

const editModal = modal({
  customID: 'notes/:ownerID/edit/:noteID',
  title: 'Edit note',
  fields: {
    content: { kind: 'text', label: 'Content' },
    title: { kind: 'text', label: 'Title', required: true }
  },
  async execute(context) {
    expectTypeOf(context.app).toEqualTypeOf<TestApp>()
    expectTypeOf(context.params).toEqualTypeOf<{ noteID: string; ownerID: string }>()
    expectTypeOf(context.values).toEqualTypeOf<{ content?: string; title: string }>()
  }
})

test('infers modal routes, build options, and context-menu targets', () => {
  expectTypeOf<ComponentRouteParams<'one/:first/two/:second'>>().toEqualTypeOf<{
    first: string
    second: string
  }>()
  expectTypeOf<Parameters<typeof deleteNote.buildID>[0]>().toEqualTypeOf<
    ComponentBuildOptions<'notes/:ownerID/delete/:noteID'>
  >()
  deleteNote.buildID({ params: { noteID: 'note', ownerID: 'owner' } })
  // @ts-expect-error noteID is required
  deleteNote.buildID({ params: { ownerID: 'owner' } })
  chooseColor.buildID({ params: { noteID: 'note' } })

  expectTypeOf<ModalRouteParams<'one/:first/two/:second'>>().toEqualTypeOf<{
    first: string
    second: string
  }>()
  expectTypeOf<Parameters<typeof editModal.build>[0]>().toEqualTypeOf<
    ModalBuildOptions<'notes/:ownerID/edit/:noteID', typeof editModal.fields>
  >()

  userMenu({
    name: 'Inspect user',
    async execute(context) {
      expectTypeOf(context.app).toEqualTypeOf<TestApp>()
      expectTypeOf(context.target.id).toBeString()
    }
  })

  messageMenu({
    name: 'Quote message',
    async execute(context) {
      expectTypeOf(context.target.content).toBeString()
    }
  })
})

test('rejects invalid component route parameters', () => {
  // @ts-expect-error duplicate route parameter names are ambiguous
  button({
    customID: 'notes/:id/edit/:id',
    async execute() {}
  })

  // @ts-expect-error empty path segments are invalid
  component({
    componentType: 'button',
    customID: 'notes//edit',
    async execute() {}
  })
})

test('rejects missing and additional modal route parameters', () => {
  editModal.build({
    // @ts-expect-error noteID is required
    params: { ownerID: 'owner' }
  })

  editModal.build({
    params: {
      noteID: 'note',
      ownerID: 'owner',
      // @ts-expect-error extra is not a route parameter
      extra: 'nope'
    }
  })

  editModal.build({
    params: { noteID: 'note', ownerID: 'owner' },
    values: {
      // @ts-expect-error missing is not a modal field
      missing: 'nope'
    }
  })
})

test('rejects structurally invalid modal routes at definition time', () => {
  // @ts-expect-error duplicate route parameter names are ambiguous
  modal({
    customID: 'notes/:id/edit/:id',
    fields: { value: { kind: 'text', label: 'Value' } },
    title: 'Duplicate',
    async execute() {}
  })

  // @ts-expect-error empty path segments are invalid
  modal({
    customID: 'notes//edit',
    fields: { value: { kind: 'text', label: 'Value' } },
    title: 'Empty',
    async execute() {}
  })
})
