import { expect, test } from 'vite-plus/test'
import { createHttpApi } from '../src/server.ts'

test('serves the Hono health endpoint without opening a gateway connection', async () => {
  const api = createHttpApi(async () => new Response(null, { status: 204 }))

  const response = await api.request('/')

  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toEqual({ service: 'rosepack-http', status: 'ok' })
})
