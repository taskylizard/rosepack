// Library mode: no build tool. Run with `node --experimental-strip-types src/index.ts`.

import { Client, Intents } from 'oceanic.js'
import { createRosepack } from 'rosepack'

/** Application state available as `context.app` in every command. */
interface AppContext {
  client: Client
  notes: Map<string, string[]>
}

// Create one rosepack instance bound to the application's context type.
const rosepack = createRosepack<AppContext>()
const { slash, slashSub } = rosepack
const prefixCommands = rosepack.createPrefixCommands()
const { prefix } = prefixCommands

// Define slash commands directly in this file.
const commands = [
  slash({
    name: 'ping',
    description: 'Check whether the bot is responding',
    async execute(context) {
      await context.reply('Pong!')
    }
  }),
  slash({
    name: 'greet',
    description: 'Send a greeting',
    options: {
      style: {
        description: 'How the bot should greet you',
        kind: 'string',
        choices: [
          { name: 'Friendly', value: 'friendly' },
          { name: 'Formal', value: 'formal' }
        ],
        required: true
      }
    },
    async execute(context) {
      const greeting = context.options.style === 'formal' ? 'Good day.' : 'Hello!'
      await context.reply(greeting)
    }
  }),
  slash({
    name: 'notes',
    description: 'Save and review personal notes',
    subcommands: {
      add: slashSub({
        description: 'Save a new note',
        options: {
          content: {
            description: 'The note to save',
            kind: 'string',
            maxLength: 1_000,
            required: true
          }
        },
        async execute(context) {
          const userID = context.interaction.user.id
          const notes = context.app.notes.get(userID) ?? []
          notes.push(context.options.content)
          context.app.notes.set(userID, notes)
          await context.reply(`Saved note ${notes.length}.`)
        }
      }),
      list: slashSub({
        description: 'Show your saved notes',
        async execute(context) {
          const notes = context.app.notes.get(context.interaction.user.id) ?? []
          await context.reply(
            notes.length === 0
              ? 'You have no saved notes.'
              : notes.map((note, index) => `${index + 1}. ${note}`).join('\n')
          )
        }
      })
    }
  })
]

// Define prefix commands with typed positional options and flags.
const prefixCommandList = [
  prefix({
    description: 'Repeat some text',
    flags: {
      uppercase: {
        aliases: ['u'],
        kind: 'boolean'
      }
    },
    name: 'echo',
    options: '[text: rest]',
    async execute(context) {
      const text = context.flags.uppercase
        ? context.options.text.toLocaleUpperCase()
        : context.options.text
      await context.reply(text)
    }
  }),
  prefix({
    description: 'Roll a die',
    name: 'roll',
    options: '[sides?: integer]',
    async execute(context) {
      const sides = context.options.sides ?? 6
      if (sides < 2) {
        await context.reply('A die needs at least two sides.')
        return
      }
      await context.reply(`You rolled ${Math.floor(Math.random() * sides) + 1} (d${sides}).`)
    }
  })
]

// Validate the definitions and build the two runtime registries.
const slashRegistry = rosepack.createRegistry(commands)
const prefixRegistry = prefixCommands.createRegistry(prefixCommandList, { prefixes: ['!'] })

const token = process.env.DISCORD_TOKEN
const expectedApplicationID = process.env.DISCORD_APPLICATION_ID
if (token === undefined || expectedApplicationID === undefined) {
  throw new Error('Set DISCORD_TOKEN and DISCORD_APPLICATION_ID in .env before starting the bot.')
}

const client = new Client({
  auth: `Bot ${token}`,
  gateway: {
    intents:
      Intents.GUILDS | Intents.GUILD_MESSAGES | Intents.DIRECT_MESSAGES | Intents.MESSAGE_CONTENT
  }
})
const app: AppContext = { client, notes: new Map() }

// Dispatch Discord events through the appropriate registry.
client.on('interactionCreate', async (interaction) => {
  await slashRegistry.dispatch({ app, interaction })
})

client.on('messageCreate', async (message) => {
  await prefixRegistry.dispatch({ app, message })
})

// Register slash commands globally once Oceanic has fetched the application.
client.once('ready', async () => {
  if (client.application.id !== expectedApplicationID) {
    throw new Error('DISCORD_APPLICATION_ID does not match the connected bot application.')
  }
  const registered = await slashRegistry.registerGlobal({
    applicationID: client.application.id,
    client
  })
  console.log(`Registered ${registered.length} global slash commands.`)
})

await client.connect()
