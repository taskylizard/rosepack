import type { Client } from 'oceanic.js'
import { expectTypeOf } from 'vite-plus/test'
import {
  createHttpInteractionHandler,
  type HttpInteractionRequestHandler,
  type RosepackUnhandledInteraction
} from '../src/http.ts'
import type { InteractionRegistry } from '../src/registry.ts'

interface AppContext {
  readonly requestID: string
}

declare const app: AppContext
declare const client: Client
declare const registry: InteractionRegistry<AppContext>

const staticHandler = createHttpInteractionHandler({
  app,
  client,
  onUnhandledInteraction(context) {
    expectTypeOf(context.app).toEqualTypeOf<AppContext>()
    expectTypeOf(context.interaction).toEqualTypeOf<RosepackUnhandledInteraction>()
  },
  publicKey: '00'.repeat(32),
  registry
})

const resolvedHandler = createHttpInteractionHandler({
  client,
  publicKey: '00'.repeat(32),
  registry,
  resolveApp({ interaction, request }) {
    expectTypeOf(interaction).not.toBeAny()
    expectTypeOf(request).toEqualTypeOf<Request>()
    return { requestID: request.headers.get('x-request-id') ?? interaction.id }
  }
})

expectTypeOf(staticHandler).toEqualTypeOf<HttpInteractionRequestHandler>()
expectTypeOf(resolvedHandler).toEqualTypeOf<HttpInteractionRequestHandler>()

// @ts-expect-error choose either a static app or resolveApp, not both
createHttpInteractionHandler({
  app,
  client,
  publicKey: '00'.repeat(32),
  registry,
  resolveApp: () => app
})

// @ts-expect-error an application context or resolver is required
createHttpInteractionHandler({ client, publicKey: '00'.repeat(32), registry })
