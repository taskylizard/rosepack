import {
  AutocompleteInteraction,
  CommandInteraction,
  ComponentInteraction,
  Interaction,
  InteractionResponseTypes,
  InteractionTypes,
  ModalSubmitInteraction
} from 'oceanic.js'
import type { AnyInteractionGateway, Client, RawInteraction } from 'oceanic.js'
import type { InteractionRegistry } from './registry.ts'

const defaultMaximumBodySize = 1_048_576
const defaultMaximumTimestampAge = 300_000
const discordSignatureHeader = 'x-signature-ed25519'
const discordTimestampHeader = 'x-signature-timestamp'
const hexPattern = /^[\da-f]+$/iu
const textEncoder = new TextEncoder()

type MaybePromise<TValue> = Promise<TValue> | TValue

/** An Oceanic interaction kind that rosepack does not route itself. */
export type RosepackUnhandledInteraction = AutocompleteInteraction | ComponentInteraction

/** Context supplied while resolving per-request application services. */
export interface HttpInteractionAppContext {
  readonly interaction: AnyInteractionGateway
  readonly request: Request
}

/** Context supplied for Oceanic interaction kinds outside rosepack's registry. */
export interface HttpUnhandledInteractionContext<TApp> extends HttpInteractionAppContext {
  readonly app: TApp
  readonly interaction: RosepackUnhandledInteraction
}

interface HttpInteractionHandlerBaseOptions<TApp> {
  /** Oceanic client used to hydrate raw Discord payloads and send interaction callbacks. */
  readonly client: Client
  /** Reject request bodies larger than this many bytes. @default 1048576 */
  readonly maximumBodySize?: number
  /** Reject signed requests older or newer than this many milliseconds. Set false to disable. */
  readonly maximumTimestampAge?: false | number
  /** Handles autocomplete and component interactions, which rosepack does not route. */
  readonly onUnhandledInteraction?: (
    context: HttpUnhandledInteractionContext<TApp>
  ) => MaybePromise<void>
  /** Discord application public key, as a 64-character hexadecimal string or 32 raw bytes. */
  readonly publicKey: string | Uint8Array
  /** Registry that handles commands, context menus, and modal submissions. */
  readonly registry: Pick<InteractionRegistry<TApp>, 'dispatch'>
  /** Require every non-PING interaction to send an initial response. @default true */
  readonly requireAcknowledgement?: boolean
}

interface HttpInteractionHandlerStaticAppOptions<TApp> {
  /** Application services shared by every interaction request. */
  readonly app: TApp
  readonly resolveApp?: never
}

interface HttpInteractionHandlerResolvedAppOptions<TApp> {
  readonly app?: never
  /** Resolves application services separately for each interaction request. */
  readonly resolveApp: (context: HttpInteractionAppContext) => MaybePromise<TApp>
}

/** Options for rosepack's Fetch-compatible Discord interaction request handler. */
export type HttpInteractionHandlerOptions<TApp> = HttpInteractionHandlerBaseOptions<TApp> &
  (HttpInteractionHandlerResolvedAppOptions<TApp> | HttpInteractionHandlerStaticAppOptions<TApp>)

export type HttpInteractionRequestHandler = (request: Request) => Promise<Response>

/**
 * Creates a Fetch-compatible Discord interaction endpoint.
 *
 * Requests are signature-checked before parsing. PING requests are answered directly;
 * commands, context menus, and modals are hydrated into Oceanic structures and sent through
 * the registry. Oceanic sends initial responses through Discord's interaction callback route,
 * so an acknowledged request completes with HTTP 204.
 */
export function createHttpInteractionHandler<TApp>(
  options: HttpInteractionHandlerOptions<TApp>
): HttpInteractionRequestHandler {
  const maximumBodySize = validatePositiveInteger(
    options.maximumBodySize ?? defaultMaximumBodySize,
    'maximumBodySize'
  )
  const maximumTimestampAge =
    options.maximumTimestampAge === false
      ? false
      : validatePositiveInteger(
          options.maximumTimestampAge ?? defaultMaximumTimestampAge,
          'maximumTimestampAge'
        )
  const requireAcknowledgement = options.requireAcknowledgement ?? true
  const publicKey = parsePublicKey(options.publicKey)
  const cryptoKey = globalThis.crypto.subtle.importKey(
    'raw',
    publicKey.buffer,
    { name: 'Ed25519' },
    false,
    ['verify']
  )

  return async (request) => {
    if (request.method !== 'POST') {
      return textResponse(405, 'Discord interaction endpoints only accept POST requests.', {
        Allow: 'POST'
      })
    }

    const declaredLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > maximumBodySize) {
      return textResponse(413, 'Discord interaction request body is too large.')
    }

    const body = new Uint8Array(await request.arrayBuffer())
    if (body.byteLength > maximumBodySize) {
      return textResponse(413, 'Discord interaction request body is too large.')
    }

    const signature = request.headers.get(discordSignatureHeader)
    const timestamp = request.headers.get(discordTimestampHeader)
    if (
      signature === null ||
      timestamp === null ||
      !isAcceptableTimestamp(timestamp, maximumTimestampAge) ||
      !(await verifySignature({ body, cryptoKey: await cryptoKey, signature, timestamp }))
    ) {
      return textResponse(401, 'Invalid Discord interaction signature.')
    }

    let raw: RawInteraction
    try {
      raw = JSON.parse(new TextDecoder().decode(body)) as RawInteraction
    } catch {
      return textResponse(400, 'Discord interaction request body must be valid JSON.')
    }

    if (!isRawInteraction(raw)) {
      return textResponse(400, 'Discord interaction request body is malformed.')
    }

    if (raw.type === InteractionTypes.PING) {
      return Response.json({ type: InteractionResponseTypes.PONG })
    }

    const interaction = Interaction.from(raw, options.client)
    if (!isGatewayInteraction(interaction)) {
      return textResponse(400, `Unsupported Discord interaction type: ${raw.type}.`)
    }

    const app =
      options.resolveApp === undefined
        ? options.app
        : await options.resolveApp({ interaction, request })

    if (
      interaction instanceof CommandInteraction ||
      interaction instanceof ModalSubmitInteraction
    ) {
      await options.registry.dispatch({ app, interaction })
    } else {
      await options.onUnhandledInteraction?.({ app, interaction, request })
    }

    if (requireAcknowledgement && !interaction.acknowledged) {
      return textResponse(
        500,
        `Discord interaction ${interaction.id} completed without an initial response.`
      )
    }

    return new Response(null, { status: 204 })
  }
}

function isAcceptableTimestamp(timestamp: string, maximumAge: false | number): boolean {
  if (!/^\d+$/u.test(timestamp)) return false
  if (maximumAge === false) return true
  const milliseconds = Number(timestamp) * 1_000
  return Number.isSafeInteger(milliseconds) && Math.abs(Date.now() - milliseconds) <= maximumAge
}

function isGatewayInteraction(interaction: Interaction): interaction is AnyInteractionGateway {
  return (
    interaction instanceof AutocompleteInteraction ||
    interaction instanceof CommandInteraction ||
    interaction instanceof ComponentInteraction ||
    interaction instanceof ModalSubmitInteraction
  )
}

function isRawInteraction(value: RawInteraction): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.application_id === 'string' &&
    typeof value.id === 'string' &&
    typeof value.token === 'string' &&
    typeof value.type === 'number' &&
    value.version === 1
  )
}

function parsePublicKey(value: string | Uint8Array): Uint8Array<ArrayBuffer> {
  if (value instanceof Uint8Array) {
    if (value.byteLength !== 32) throw new TypeError('publicKey must contain exactly 32 bytes.')
    return Uint8Array.from(value)
  }
  if (value.length !== 64 || !hexPattern.test(value)) {
    throw new TypeError('publicKey must be a 64-character hexadecimal string.')
  }
  return Uint8Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  )
}

function textResponse(
  status: number,
  message: string,
  headers?: Readonly<Record<string, string>>
): Response {
  return new Response(message, {
    headers: { 'content-type': 'text/plain; charset=UTF-8', ...headers },
    status
  })
}

function validatePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer.`)
  }
  return value
}

async function verifySignature(options: {
  readonly body: Uint8Array
  readonly cryptoKey: CryptoKey
  readonly signature: string
  readonly timestamp: string
}): Promise<boolean> {
  if (options.signature.length !== 128 || !hexPattern.test(options.signature)) return false
  const timestamp = textEncoder.encode(options.timestamp)
  const message = new Uint8Array(timestamp.byteLength + options.body.byteLength)
  message.set(timestamp)
  message.set(options.body, timestamp.byteLength)
  const signature = Uint8Array.from({ length: 64 }, (_, index) =>
    Number.parseInt(options.signature.slice(index * 2, index * 2 + 2), 16)
  )
  return globalThis.crypto.subtle.verify(
    'Ed25519',
    options.cryptoKey,
    signature.buffer,
    message.buffer
  )
}
