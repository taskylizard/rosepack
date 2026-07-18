import { serve } from '@hono/node-server'
import { Client } from 'oceanic.js'
import { createHttpInteractionHandler } from 'rosepack/http'
import slashCommands from 'virtual:rosepack/slash-commands'
import type { AppContext } from './context.ts'
import { rosepack } from './framework.ts'
import { createHttpApi } from './server.ts'

export interface HttpAppOptions {
  readonly port: number
  readonly publicKey: string
  readonly token: string
}

export function createApp(options: HttpAppOptions) {
  const client = new Client({ auth: `Bot ${options.token}` })
  const interactionRegistry = rosepack.createCompiledRegistry({ slashCommands })
  const context: AppContext = { client, startedAt: Date.now() }
  const handleInteraction = createHttpInteractionHandler({
    app: context,
    client,
    publicKey: options.publicKey,
    registry: interactionRegistry
  })
  const api = createHttpApi(handleInteraction)
  let server: ReturnType<typeof serve> | undefined

  return {
    api,
    interactionRegistry,
    async start(): Promise<void> {
      if (server !== undefined) return
      await client.restMode(false)
      server = serve({ fetch: api.fetch, port: options.port })
      console.log(`rosepack HTTP endpoint listening on http://localhost:${options.port}`)
    },
    async stop(): Promise<void> {
      const runningServer = server
      server = undefined
      if (runningServer === undefined) return
      await new Promise<void>((resolve, reject) => {
        runningServer.close((error) => (error === undefined ? resolve() : reject(error)))
      })
    }
  }
}
