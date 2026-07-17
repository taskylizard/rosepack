import { Client, Intents } from 'oceanic.js'
import messageContextMenus from 'virtual:rosepack/message-context-menus'
import modals from 'virtual:rosepack/modals'
import prefixCommandList from 'virtual:rosepack/prefix-commands'
import slashCommands from 'virtual:rosepack/slash-commands'
import userContextMenus from 'virtual:rosepack/user-context-menus'
import { NotesService, ReminderService, StatsService, type AppContext } from './context.ts'
import { prefixCommands, rosepack } from './framework.ts'

export function createApp(token: string) {
  const client = new Client({
    auth: `Bot ${token}`,
    gateway: {
      intents:
        Intents.GUILDS | Intents.GUILD_MESSAGES | Intents.DIRECT_MESSAGES | Intents.MESSAGE_CONTENT
    }
  })
  const interactionRegistry = rosepack.createCompiledRegistry({
    messageContextMenus,
    modals,
    slashCommands,
    userContextMenus
  })
  const prefixRegistry = prefixCommands.createCompiledRegistry(prefixCommandList, {
    prefixes: ['!']
  })
  const app: AppContext = {
    client,
    notes: new NotesService(),
    reminders: new ReminderService(),
    stats: new StatsService()
  }

  client.on('interactionCreate', async (interaction) => {
    await interactionRegistry.dispatch({ app, interaction })
  })
  client.on('messageCreate', async (message) => {
    await prefixRegistry.dispatch({ app, message })
  })

  return {
    client,
    prefixRegistry,
    interactionRegistry,
    start: async () => {
      if (client.ready) return
      const ready = new Promise<void>((resolve) => client.once('ready', resolve))
      await client.connect()
      await ready
    },
    stop: () => client.disconnect(false)
  }
}
