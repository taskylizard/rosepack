import { Client, Intents } from 'oceanic.js'
import commands from 'virtual:rosepack/commands'
import prefixCommandList from 'virtual:rosepack/prefix-commands'
import { NotesService, type AppContext } from './context.ts'
import { prefixCommands, rosepack } from './framework.ts'

/** Creates an Oceanic client and connects rosepack's registry to its lifecycle. */
export function createApp(token: string) {
  const client = new Client({
    auth: `Bot ${token}`,
    gateway: {
      intents:
        Intents.GUILDS | Intents.GUILD_MESSAGES | Intents.DIRECT_MESSAGES | Intents.MESSAGE_CONTENT
    }
  })
  const slashRegistry = rosepack.createCompiledRegistry(commands)
  const prefixRegistry = prefixCommands.createCompiledRegistry(prefixCommandList, { prefixes: '!' })
  const app: AppContext = {
    client,
    notes: new NotesService()
  }

  client.on('interactionCreate', async (interaction) => {
    await slashRegistry.dispatch({ app, interaction })
  })

  client.on('messageCreate', async (message) => {
    await prefixRegistry.dispatch({ app, message })
  })

  return {
    client,
    prefixRegistry,
    slashRegistry,
    start: async () => {
      if (client.ready) {
        return
      }
      const ready = new Promise<void>((resolve) => client.once('ready', resolve))
      await client.connect()
      await ready
    },
    stop: () => {
      client.disconnect(false)
    }
  }
}
