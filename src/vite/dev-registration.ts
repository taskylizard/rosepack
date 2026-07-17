import { Client } from 'oceanic.js'
import { createDebug } from 'obug'
import { loadEnv, type ResolvedConfig } from 'vite'
import { reconcileApplicationCommands } from '../registration.ts'
import type { RosepackBuildManifest, RosepackDevelopmentOptions } from './types.ts'

const debug = createDebug('rosepack:vite:dev')
const registrationDebug = debug.extend('registration')

export class DevelopmentRegistration {
  readonly #options: RosepackDevelopmentOptions
  readonly #config: ResolvedConfig

  constructor(config: ResolvedConfig, options: RosepackDevelopmentOptions = {}) {
    this.#config = config
    this.#options = options
  }

  async reconcile(manifest: RosepackBuildManifest, reason: string): Promise<void> {
    if (this.#config.mode === 'test' || this.#options.guildRegistration === false) return
    const environment = loadEnv(this.#config.mode, this.#config.root, '')
    const applicationID = environment[this.#options.applicationIDEnv ?? 'DISCORD_APPLICATION_ID']
    const guildID = environment[this.#options.guildIDEnv ?? 'DISCORD_DEV_GUILD_ID']
    const token = environment[this.#options.tokenEnv ?? 'DISCORD_TOKEN']
    if (applicationID === undefined || guildID === undefined || token === undefined) {
      registrationDebug('skipped (%s): development Discord environment is incomplete', reason)
      return
    }
    const commands = [
      ...manifest.slashCommands,
      ...manifest.userContextMenus,
      ...manifest.messageContextMenus
    ]
    registrationDebug('reconciling %d application commands (%s)', commands.length, reason)
    const client = new Client({ auth: `Bot ${token}` })
    const authenticatedApplication = await client.rest.applications.getCurrent()
    if (authenticatedApplication.id !== applicationID) {
      throw new DevelopmentApplicationMismatchError()
    }
    const result = await reconcileApplicationCommands({
      applicationID,
      client,
      guildID,
      payload: commands.map((command) => command.payload)
    })
    const changed = result.filter((command) => command.action !== 'unchanged')
    registrationDebug(
      'actions: %o',
      result.map(({ action, name }) => ({ action, name }))
    )
    registrationDebug(
      'complete: %d changed, %d unchanged',
      changed.length,
      result.length - changed.length
    )
  }
}

export class DevelopmentApplicationMismatchError extends Error {
  readonly code = 'application-mismatch'

  constructor() {
    super(
      'DISCORD_APPLICATION_ID does not belong to the application authenticated by DISCORD_TOKEN.'
    )
    this.name = 'DevelopmentApplicationMismatchError'
  }
}
