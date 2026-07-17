# 🌹 rosepack

rosepack is a highly-typed slash and prefix-command framework for [oceanic](https://oceanic.ws).

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

The `examples/` directory contains three complete bots you can copy and run:

- **[Library mode](examples/library)** — A minimal bot with no build tool. Commands,
  registries, registration, and dispatch all live in a single file run directly with
  `node --experimental-strip-types`.
- **[Framework mode](examples/rosepack)** — A small but complete bot using the
  `rosepack/vite` plugin: filesystem-based command discovery, compile-time validation,
  dev guild sync, HMR, production bundling, and the registration CLI.
- **[Starter app](examples/starter)** — A fully-fledged framework-mode app showcasing
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
export const { slash, slashSub } = rosepack

export const prefixCommands = rosepack.createPrefixCommands()
export const { prefix } = prefixCommands
```

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
`deleteResponse`. `reply` will create the first response, or — if you've already deferred
— edit the original response instead. That means less fiddly acknowledgement-state
branching in every single handler.

## Register and dispatch

```ts
const registry = rosepack.createRegistry(commands)

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

`dispatch` quietly ignores interactions that aren't commands. Unknown chat-input
commands get handed to `onUnknownCommand` if you've configured one.

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
