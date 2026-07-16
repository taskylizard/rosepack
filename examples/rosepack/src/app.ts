import { Client, Intents } from 'oceanic.js'
import { commands } from './commands/index.ts'
import { NotesService, type AppContext } from './context.ts'
import { prefixCommands, rosepack } from './framework.ts'
import { prefixCommandList } from './prefix-commands/index.ts'

/** Creates an Oceanic client and connects rosepack's registry to its lifecycle. */
export function createApp(token: string) {
  const client = new Client({
    auth: `Bot ${token}`,
    gateway: {
      intents:
        Intents.GUILDS | Intents.GUILD_MESSAGES | Intents.DIRECT_MESSAGES | Intents.MESSAGE_CONTENT
    }
  })
  const slashRegistry = rosepack.createRegistry(commands)
  const prefixRegistry = prefixCommands.createRegistry(prefixCommandList, { prefixes: '!' })
  const app: AppContext = {
    client,
    notes: new NotesService()
  }

  client.once('ready', async () => {
    const registered = await slashRegistry.registerGlobal({
      applicationID: client.application.id,
      client
    })
    console.info(`Registered ${registered.length} slash commands.`)
  })

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
    start: () => client.connect(),
    stop: () => {
      client.disconnect(false)
    }
  }
}
