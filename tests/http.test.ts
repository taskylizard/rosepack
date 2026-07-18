import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { Client, CommandInteraction, InteractionTypes } from 'oceanic.js'
import { expect, test, vi } from 'vite-plus/test'
import { createHttpInteractionHandler } from '../src/http.ts'

const keys = createSigningKeys()

test('answers signed Discord PING requests without dispatching them', async () => {
  const signing = await keys
  const dispatch = vi.fn(async () => undefined)
  const handler = createHttpInteractionHandler({
    app: {},
    client: createClient(),
    publicKey: signing.publicKey,
    registry: { dispatch }
  })

  const response = await handler(await signedRequest(signing, pingPayload()))

  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toEqual({ type: 1 })
  expect(dispatch).not.toHaveBeenCalled()
})

test('hydrates signed HTTP commands with Oceanic and dispatches them through rosepack', async () => {
  const signing = await keys
  const client = createClient()
  const createInteractionResponse = vi
    .spyOn(client.rest.interactions, 'createInteractionResponse')
    .mockResolvedValue(undefined as never)
  const app = { source: 'http' }
  const dispatch = vi.fn(async (config) => {
    expect(config.app).toBe(app)
    expect(config.interaction).toBeInstanceOf(CommandInteraction)
    await (config.interaction as CommandInteraction).defer()
  })
  const handler = createHttpInteractionHandler({
    app,
    client,
    publicKey: signing.publicKey,
    registry: { dispatch }
  })

  const response = await handler(await signedRequest(signing, commandPayload()))

  expect(response.status).toBe(204)
  expect(dispatch).toHaveBeenCalledOnce()
  expect(createInteractionResponse).toHaveBeenCalledWith(
    'interaction-id',
    'interaction-token',
    { data: { flags: undefined }, type: 5 },
    true
  )
})

test('rejects invalid signatures and signed requests outside the replay window', async () => {
  const signing = await keys
  const handler = createHttpInteractionHandler({
    app: {},
    client: createClient(),
    publicKey: signing.publicKey,
    registry: { dispatch: vi.fn(async () => undefined) }
  })
  const invalid = await signedRequest(signing, pingPayload())
  invalid.headers.set('x-signature-ed25519', '00'.repeat(64))
  const oldTimestamp = String(Math.floor(Date.now() / 1_000) - 600)

  expect((await handler(invalid)).status).toBe(401)
  expect((await handler(await signedRequest(signing, pingPayload(), oldTimestamp))).status).toBe(
    401
  )
})

test('reports valid interactions that complete without an initial response', async () => {
  const signing = await keys
  const handler = createHttpInteractionHandler({
    app: {},
    client: createClient(),
    publicKey: signing.publicKey,
    registry: { dispatch: vi.fn(async () => undefined) }
  })

  const response = await handler(await signedRequest(signing, commandPayload()))

  expect(response.status).toBe(500)
  await expect(response.text()).resolves.toContain('completed without an initial response')
})

function commandPayload() {
  return {
    app_permissions: '0',
    application_id: 'application-id',
    attachment_size_limit: 10_485_760,
    authorizing_integration_owners: {},
    channel_id: 'channel-id',
    context: 1,
    data: {
      id: 'command-id',
      name: 'ping',
      type: 1
    },
    entitlements: [],
    id: 'interaction-id',
    locale: 'en-US',
    token: 'interaction-token',
    type: InteractionTypes.APPLICATION_COMMAND,
    user: {
      avatar: null,
      discriminator: '0',
      global_name: 'Rose',
      id: 'user-id',
      username: 'rose'
    },
    version: 1
  }
}

function createClient(): Client {
  return new Client({ auth: null })
}

async function createSigningKeys(): Promise<{ privateKey: KeyObject; publicKey: string }> {
  const pair = generateKeyPairSync('ed25519')
  const publicKey = pair.publicKey.export({ format: 'jwk' }).x
  if (publicKey === undefined) throw new Error('Ed25519 public key did not include x.')
  return {
    privateKey: pair.privateKey,
    publicKey: Buffer.from(publicKey, 'base64url').toString('hex')
  }
}

function pingPayload() {
  return {
    application_id: 'application-id',
    id: 'ping-id',
    token: 'ping-token',
    type: InteractionTypes.PING,
    version: 1
  }
}

async function signedRequest(
  signing: Awaited<ReturnType<typeof createSigningKeys>>,
  payload: object,
  timestamp = String(Math.floor(Date.now() / 1_000))
): Promise<Request> {
  const body = JSON.stringify(payload)
  const signature = sign(null, Buffer.from(timestamp + body), signing.privateKey).toString('hex')
  return new Request('https://example.com/interactions', {
    body,
    headers: {
      'content-type': 'application/json',
      'x-signature-ed25519': signature,
      'x-signature-timestamp': timestamp
    },
    method: 'POST'
  })
}
