import { expectTypeOf, test } from 'vite-plus/test'
import { createRosepack, type ModalBuildOptions, type ModalRouteParams } from '../src/index.ts'

interface TestApp {
  service: 'test'
}

const { messageMenu, modal, userMenu } = createRosepack<TestApp>()

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
