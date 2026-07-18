# 🌹 rosepack

rosepack is a highly typed interaction and prefix-command framework for [oceanic](https://oceanic.ws).

> [!NOTE]
> Not yet published on npm

## How to use

You can use rosepack in two ways:

- Library mode: You do the setup for command registry construction, registration, process startup, and does not require a build tool aka Vite.
- Framework mode: with the `rosepack/vite` Vite plugin, rosepack wraps Library mode and provides:
  - Filesystem-based commands construction
  - Compile-time validation
  - Development guild synchronization
  - Smart hot-module reloading
  - Production bundling so you have everything needed, via Vite
  - The registration cli, only changing what was changed

What should you use? Well, it's about how much you want to do yourself.

##### Use Framework mode if you:

- are too new to have an opinion
- need structured and a streamlined experience with best practices

##### Use Library mode if you:

- want to use rosepack as simply as possible
- don't want a build-tool
- can handle everything yourself

## Examples

The `examples/` directory contains four complete bots you can copy and run:

- **[Library mode](examples/library)**: A minimal bot with no build tool. Commands,
  registries, registration, and dispatch all live in a single file run directly with
  `node --experimental-strip-types`.
- **[Framework mode](examples/rosepack)**: A small but complete bot using the
  `rosepack/vite` plugin: filesystem-based command discovery, compile-time validation,
  dev guild sync, HMR, production bundling, and the registration CLI.
- **[HTTP mode with Hono](examples/http)**: A framework-mode bot receiving Discord interactions
  through a signed Hono HTTP endpoint without opening a Gateway connection.
- **[Starter app](examples/starter)**: A fully-fledged framework-mode app showcasing
  every rosepack feature: flat commands, options with choices, slash subcommands and
  groups, prefix commands with positional options and flags, prefix subcommands, a
  custom prefix parser, lifecycle hooks, response helpers, and cross-command
  invocation.

## Set up rosepack

First, bind your app's services to rosepack **once**. After that you just import the
helpers wherever your commands live:

```ts
import { createRosepack } from 'rosepack'

interface AppContext {
  notes: NotesService
}

export const rosepack = createRosepack<AppContext>()
export const { messageMenu, modal, slash, slashSub, userMenu } = rosepack

export const prefixCommands = rosepack.createPrefixCommands()
export const { prefix } = prefixCommands
```

That is library mode: command names are explicit because rosepack has no filename context. In
framework mode, bind the file builders instead. Their names are derived from the filesystem:

```ts
export const { slashFile: slash, slashGroup, slashSub } = rosepack
export const { prefixFile: prefix } = prefixCommands
```

Framework command files therefore omit `name`. An explicit name is accepted temporarily for
migration, but it must exactly match the filename-derived name.

## Prefix commands

```ts
export default prefix({
  name: 'ban',
  aliases: ['b'],
  options: '[user: User] [reason?: rest]',
  flags: {
    force: { aliases: ['f'], kind: 'boolean' },
    days: { aliases: ['d'], parser: 'integer' }
  },

  async execute(context) {
    context.options.user // oceanic User
    context.options.reason // string | undefined
    context.flags.force // boolean
    context.flags.days // number | undefined
  }
})
```

Just self-explanatory but things to keep in mind:

- `options` here is positional, and provides both typechecking and runtime checking at startup (build-time if using Framework mode) out of the box
- You may use the same `prefix()` function to build subcommands
- `[name: Parser]` is required, `[name?: Parser]` is optional.
- A `rest`-consuming parser has to be last, since it eats everything after it.
- The built-in parsers are `string`, `integer`, `number`, `boolean`, `rest`, `User`,
  `Member`, `Role`, `Channel`, and `Mentionable`. The discord-object parsers happily
  accept both raw ids and mentions.

Flags live separately from the positional schema, and are as follows:

- Boolean flags understand `--force`, `--no-force`, and short aliases like `-f`.
- Value flags understand `--days 7`,`--days=7`, required values, and repeated values when you set `multiple: true`.
- A bare `--` stops flag parsing from that point on.

You shouldn't need this but custom parsers are possible as well:

```ts
const Duration = rosepack.prefixParser({
  consumption: 'token',
  parse({ value, fail }) {
    const seconds = parseDuration(value)
    return seconds === undefined ? fail('invalid duration') : seconds
  }
})

export const prefixCommands = rosepack.createPrefixCommands({
  parsers: { Duration }
})
```

Now `[timeout: Duration]` gives you a `number`. When a parser fails, the failure becomes a structured `PrefixCommandParseError` value instead of an unstructured throw.

Prefix subcommands can nest up to 32 levels deep, and every root or child node is built with the same `prefix()`.

```ts
const moderation = prefix({
  name: 'moderation',
  aliases: ['mod'],
  subcommands: [
    prefix({
      name: 'users',
      subcommands: [banCommand, unbanCommand]
    })
  ]
})
```

Executable nodes can carry subcommands of their own. When routing, a matching child
always is selected, before a token is treated as a positional option.

Once your commands are defined, build a registry and dispatch oceanic's message event
through it:

```ts
const prefixRegistry = prefixCommands.createRegistry(commands, {
  prefixes: ['!', '?']
})

client.on('messageCreate', async (message) => {
  await prefixRegistry.dispatch({ app, message })
})
```

Prefixes can be picked asynchronously per message if you'd rather. The registry ignores
bot and webhook messages by default, and there's a lot more baked in: quoted arguments,
backslash escapes, longest-prefix matching, case-insensitive aliases, parse and execution
hooks, safe-by-default replies, tree lookup, and typed command invocation.

## Define a slash command

```ts
import { slash } from '../rosepack.ts'

export default slash({
  name: 'ping',
  description: 'check whether the bot is responding',
  contexts: ['guild', 'botDm', 'privateChannel'],
  installations: ['guild', 'user'],

  async execute(context) {
    await context.reply('pong')
  }
})
```

## Options

```ts
export default slash({
  name: 'greet',
  description: 'send a greeting',
  options: {
    style: {
      description: 'greeting style',
      kind: 'string',
      choices: [
        { name: 'brief', value: 'brief' },
        { name: 'warm', value: 'warm' }
      ],
      required: true
    }
  },

  async execute(context) {
    await context.reply(context.options.style === 'warm' ? 'good to see you' : 'hey')
  }
})
```

## Subcommands and groups

Use `slashSub()` for slash subcommands, this is a separate helper to help enforce discord's commands limits and more tighter typesafety.

```ts
export default slash({
  name: 'notes',
  description: 'manage notes',
  subcommands: {
    add: slashSub({
      description: 'add a note',
      options: {
        content: {
          description: 'note content',
          kind: 'string',
          required: true
        }
      },

      async execute(context) {
        context.app.notes.add(context.interaction.user.id, context.options.content)
        await context.reply('saved')
      }
    }),
    admin: {
      description: 'administrative note actions',
      subcommands: {
        clear: slashSub({
          description: 'clear all notes',

          async execute(context) {
            context.app.notes.clear()
            await context.reply('cleared')
          }
        })
      }
    }
  }
})
```

Discord only allows the shape command → group → subcommand, and the types enforce that.
They stop you from nesting groups deeper, making groups executable, putting a root
handler on a routed command, leaving a group empty, or building a leaf without
`slashSub()`. If you want to ignore a type-error for some reason (I would love to know why!) you can add `// @ts-expect-error` above the line.

- For Library mode: The registry runs the same checks again at runtime, so nothing invalid ever reaches Discord.
- For Framework mode: The checks happen at build/dev time, removing the startup runtime cost that shouldn't be needed.

## Hooks and responses

Commands can define `beforeExecute(context)` and `onError(context, error)`.

The response helpers are `defer`, `reply`, `editResponse`, `followUp`, and
`deleteResponse`. `reply` creates the first response or edits the original response after a defer.

## Context menus

User and message context menus use separate builders so their targets stay precisely typed:

```ts
export const inspectUser = userMenu({
  name: 'Inspect user',

  async execute(context) {
    context.target // oceanic User
    await context.reply(`User: ${context.target.id}`)
  }
})

export const quoteMessage = messageMenu({
  name: 'Quote message',

  async execute(context) {
    context.target // oceanic Message
    await context.reply(context.target.content || '(no text)')
  }
})
```

Context menus support the same application context, installation/context metadata, lifecycle
hooks, response helpers, and `showModal()` method as slash commands.

## Modals

Modal route parameters and submitted fields are inferred from one definition:

```ts
export const editNoteModal = modal({
  customID: 'notes.edit/:noteID',
  title: 'Edit note',

  fields: {
    title: {
      kind: 'text',
      label: 'Title',
      required: true,
      maxLength: 100
    },
    content: {
      kind: 'text',
      label: 'Content',
      style: 'paragraph'
    }
  },

  async execute(context) {
    context.params.noteID // string
    context.values.title // string
    context.values.content // string | undefined
    await context.reply('saved')
  }
})
```

Open it from any slash or context-menu handler:

```ts
await context.showModal(editNoteModal, {
  params: { noteID: note.id },
  values: { title: note.title, content: note.content }
})
```

Raw Oceanic component handlers can use the same typed definition:

```ts
await interaction.createModal(
  editNoteModal.build({
    params: { noteID: note.id },
    values: { title: note.title }
  })
)
```

Route parameters are URL encoded into Discord's custom ID and decoded on submission. They are
untrusted routing data, so handlers must still authorize access to referenced resources.

## Register and dispatch

```ts
const registry = rosepack.createRegistry({
  slashCommands,
  userContextMenus,
  messageContextMenus,
  modals
})

client.once('ready', async () => {
  await registry.registerGlobal({
    applicationID: client.application.id,
    client
  })
})

client.on('interactionCreate', async (interaction) => {
  await registry.dispatch({ app, interaction })
})
```

`dispatch` routes slash commands, user context menus, message context menus, and modal submissions.
Unknown application commands and modals are handed to `onUnknownCommand` and `onUnknownModal` when
configured.

## HTTP Mode

HTTP Mode receives Discord interactions without a Gateway connection. It supports slash commands,
context menus, and modals through any Fetch-compatible server.

Here's Hono:

```ts
import { Hono } from 'hono'
import { Client } from 'oceanic.js'
import { createHttpInteractionHandler } from 'rosepack/http'

const client = new Client({ auth: `Bot ${process.env.DISCORD_TOKEN}` })
await client.restMode(false)

const handleInteraction = createHttpInteractionHandler({
  app,
  client,
  publicKey: process.env.DISCORD_PUBLIC_KEY!,
  registry
})

const api = new Hono()
api.post('/interactions', (context) => handleInteraction(context.req.raw))
```

The handler verifies the request, responds to Discord PINGs, creates an Oceanic interaction, and
dispatches it to the registry.

Prefix commands still require the Gateway. Use `onUnhandledInteraction` for autocomplete and
component interactions.

[→ View the Hono example](examples/http).

## Framework discovery and generated types

Framework mode keeps every interaction kind in its own default directory:

```text
src/
  slash-commands/
    ping.ts
    notes/
      _command.ts
      add.ts
      show.ts
    admin/
      _command.ts
      server/
        _group.ts
        inspect.ts
  user-context-menus/
  message-context-menus/
  modals/
  prefix-commands/
    admin/
      _command.ts
      users/
        _command.ts
        ban.ts
```

The path is the command route. `ping.ts` becomes `/ping`; `notes/add.ts` becomes
`/notes add`; and `admin/server/inspect.ts` becomes `/admin server inspect`. Slash command trees
follow Discord's exact root → optional group → leaf limit:

- `_command.ts` defines metadata for a directory command and omits `name` and `subcommands`.
- A direct child file exports `slashSub({ ... })`.
- `_group.ts` exports `slashGroup({ description })`; its child files export `slashSub()`.
- Slash path segments must already be valid lowercase Discord command names. rosepack does not
  silently rewrite filenames.

Prefix routes use the same directory convention, but every directory node uses `_command.ts` and
may nest arbitrarily. Leaf files and directory metadata both use the framework `prefix()` alias.
Children are assembled from files, so `_command.ts` must not declare `subcommands` manually.

It generates exact virtual-module tuples and a modal catalog under `.rosepack/`. Include the
generated declarations in the application's TypeScript project:

```json
{
  "compilerOptions": {
    "paths": {
      "#rosepack/*": ["./.rosepack/*"]
    }
  },
  "include": ["src", "tests", "vite.config.ts", ".rosepack/**/*.d.ts"]
}
```

`vp dev` and `vp build` regenerate this directory automatically. Run `vp exec rosepack prepare`
after cloning when the editor needs generated types before either command has run.

The generated catalog enables route-string autocomplete and exact parameter checking:

```ts
await context.showModal('notes.edit/:noteID', {
  params: { noteID: note.id }
})
```

## Inspect and invoke commands

`registry.tree` is an immutable view of every command node. You can find commands with
`registry.get('ping')`, `registry.get(commandDefinition)`, or
`registry.resolve('/notes admin clear')`.

Inside a handler, the registry lives on `context.registry`. `context.command` is the
root node and `context.node` is the selected leaf.

You can also invoke another registered executable definition or node directly:

```ts
await context.invoke(otherCommand, {
  requiredOption: 'value'
})
```

The options are still validated, and recursive calls are rejected.

## Validation

`createRegistry` throws a `CommandTreeValidationError` _before_ any Discord API call when
the tree is invalid, so you aren't pushing bogus to discord's API. Its `issues` property carries stable codes, paths, and readable messages.

If you'd rather inspect without throwing, `lintSlashCommandTree(commands)` returns the
issues directly. `slashCommandToDiscord(command)` builds a single validated Discord
payload.
