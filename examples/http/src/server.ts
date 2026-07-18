import { Hono } from 'hono'
import type { HttpInteractionRequestHandler } from 'rosepack/http'

export function createHttpApi(handleInteraction: HttpInteractionRequestHandler) {
  return new Hono()
    .get('/', (hono) => hono.json({ service: 'rosepack-http', status: 'ok' }))
    .post('/interactions', (hono) => handleInteraction(hono.req.raw))
}
