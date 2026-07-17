import { createDebug } from 'obug'
import { loadEnv, type ViteDevServer } from 'vite'
import type { RosepackDevelopmentOptions } from './types.ts'

const debug = createDebug('rosepack:vite:dev:host')

export interface RosepackDevelopmentHost {
  stop(): Promise<void> | void
}

type StartDevelopmentHost = (context: {
  readonly environment: Readonly<Record<string, string | undefined>>
}) => Promise<RosepackDevelopmentHost | void> | RosepackDevelopmentHost | void

export class DevelopmentHostSupervisor {
  readonly #entry: string
  readonly #options: RosepackDevelopmentOptions
  readonly #server: ViteDevServer
  #host: RosepackDevelopmentHost | undefined
  #restartChain: Promise<void> = Promise.resolve()

  constructor(server: ViteDevServer, entry: string, options: RosepackDevelopmentOptions = {}) {
    this.#entry = entry
    this.#options = options
    this.#server = server
  }

  start(): Promise<void> {
    return this.#enqueueRestart('server start')
  }

  restart(reason: string): Promise<void> {
    return this.#enqueueRestart(reason)
  }

  async stop(): Promise<void> {
    const host = this.#host
    this.#host = undefined
    await host?.stop()
    if (host !== undefined) debug('stopped')
  }

  #enqueueRestart(reason: string): Promise<void> {
    this.#restartChain = this.#restartChain.then(async () => {
      await this.stop()
      const loaded = await this.#server.ssrLoadModule(this.#entry)
      const exportName = this.#options.hostExport ?? 'startRosepackApp'
      const start = loaded[exportName]
      if (typeof start !== 'function') {
        throw new Error(
          `rosepack development entry ${this.#entry} must export ${exportName}({ environment }).`
        )
      }
      const environment = loadEnv(this.#server.config.mode, this.#server.config.root, '')
      this.#host = (await (start as StartDevelopmentHost)({ environment })) ?? undefined
      debug('started (%s)', reason)
    })
    return this.#restartChain
  }
}
