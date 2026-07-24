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

The repository has four runnable examples. Pick the smallest one that matches how your bot receives events:

| Example                        | Use it for               | What it covers                                                                    |
| ------------------------------ | ------------------------ | --------------------------------------------------------------------------------- |
| [Library](examples/library)    | A bot without Vite       | Explicit command definitions, registries, Gateway events, and global registration |
| [Framework](examples/rosepack) | A normal Gateway bot     | Filesystem discovery, generated types, HMR, and the registration CLI              |
| [Starter](examples/starter)    | A feature tour           | Nested slash and prefix commands, hooks, parsers, and command invocation          |
| [HTTP](examples/http)          | An interactions endpoint | Signed Hono requests without a Gateway connection                                 |

From the repository root, install once and run the compact framework example:

```sh
vp install
cd examples/rosepack
vp exec rosepack prepare
vp dev
```

Create `.env` in the example directory before `vp dev`:

```dotenv
DISCORD_TOKEN=your-bot-token
DISCORD_APPLICATION_ID=your-application-id
DISCORD_DEV_GUILD_ID=your-development-guild-id
```

The example registers commands into `DISCORD_DEV_GUILD_ID` while developing. The [library example](examples/library) needs only `DISCORD_TOKEN` and `DISCORD_APPLICATION_ID`; the [HTTP example](examples/http) also needs `DISCORD_PUBLIC_KEY` and a listening `PORT`.

## Bind rosepack to your application

Start with one file that binds your application context. Call `createRosepack` once, then import the builders from that bound instance.

In library mode, this can be `src/rosepack.ts`:

```ts
import { createRosepack } from 'rosepack'
import type { NotesService } from './context.ts'

export interface AppContext {
  notes: NotesService
}

export const rosepack = createRosepack<AppContext>()
export const { messageMenu, modal, slash, slashSub, userMenu } = rosepack

export const prefixCommands = rosepack.createPrefixCommands()
export const { prefix } = prefixCommands
```

The generic only describes the object passed as `context.app`. It does not store a singleton application state inside rosepack. Your startup code creates `AppContext` and passes it to every dispatch call.

Framework mode uses the same binding, but filename-based builders take the command name from the path:

```ts
export const { messageMenu, modal, slashFile: slash, slashSub, userMenu } = rosepack
export const { prefixFile: prefix } = prefixCommands
```

A library command uses `slash` or `prefix` and supplies `name`. A framework file uses the aliases above and leaves `name` out. The framework checks an explicit name during migration and requires it to match the filename.

## Define a slash command

Add a flat command to `src/commands/ping.ts`:

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

In framework mode, the same file imports the `slash` alias bound to `slashFile` and drops `name`. `contexts` and `installations` are optional metadata; the handler still receives an Oceanic `CommandInteraction` through `context.interaction`.

The definition is just data plus an executor. Nothing talks to Discord until a registry is built and an event is dispatched.

## Add typed options

Options are ordinary object properties, so TypeScript can infer the handler input from the definition:

```ts
export default slash({
  name: 'greet',
  description: 'send a greeting',
  options: {
    style: {
      choices: [
        { name: 'Brief', value: 'brief' },
        { name: 'Warm', value: 'warm' }
      ],
      description: 'how the greeting should sound',
      kind: 'string',
      required: true
    }
  },

  async execute(context) {
    const greeting = context.options.style === 'warm' ? 'good to see you' : 'hello'
    await context.reply(greeting)
  }
})
```

Here `context.options.style` is the literal union `'brief' | 'warm'`, not an arbitrary string. Invalid option definitions, command names, and Discord limits on options or choices are checked when the registry is built. At dispatch time, rosepack parses the interaction and rejects a missing required option or a value outside its choices. Framework mode runs the definition checks during discovery and build.

## Subcommands and groups

A routed command has a root definition and executable leaves. Use `slashSub` for every leaf:

```ts
export default slash({
  name: 'notes',
  description: 'manage personal notes',
  subcommands: {
    add: slashSub({
      description: 'save a note',
      options: {
        content: {
          description: 'the note to save',
          kind: 'string',
          maxLength: 1_000,
          required: true
        }
      },

      async execute(context) {
        const count = context.app.notes.add(context.interaction.user.id, context.options.content)
        await context.reply(`saved note ${count}`)
      }
    }),
    list: slashSub({
      description: 'list saved notes',

      async execute(context) {
        const notes = context.app.notes.list(context.interaction.user.id)
        await context.reply(notes.length === 0 ? 'no saved notes' : notes.join('\n'))
      }
    }),
    admin: {
      description: 'administrative note actions',
      subcommands: {
        clear: slashSub({
          description: 'clear your notes',

          async execute(context) {
            context.app.notes.clear(context.interaction.user.id)
            await context.reply('cleared')
          }
        })
      }
    }
  }
})
```

Discord permits only `command → group → subcommand`. The root `notes` cannot also have an `execute` function or options; `admin` cannot execute; and a leaf must be made with `slashSub`. Each level has Discord's 25-child limit. These constraints are represented in the builder types and checked again by `createRegistry`.

## Build, register, and dispatch the registry

Once definitions exist, put them in an `InteractionRegistry`. The registry freezes the command tree, converts application commands to Discord payloads, and gives dispatch a single route:

```ts
const registry = rosepack.createRegistry({
  messageContextMenus,
  modals,
  slashCommands,
  userContextMenus
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

The snippet assumes `client` is an Oceanic `Client`, `app` is your `AppContext`, and the four arrays contain the definitions from the next section. `registerGlobal` bulk-replaces the application's global application-command payloads with this registry. For guild registration or incremental production registration, use the framework CLI or `registry.modules` instead.

A root command can install `beforeExecute(context)` and `onError(context, error)` hooks. The same lifecycle hooks are available on context menus and modals. Interaction handlers use `defer`, `reply`, `editResponse`, `followUp`, and `deleteResponse`; `reply` creates the first response and edits the original response after a defer.

## Add context menus and a modal

Context menus use separate builders, which narrows `context.target` to an Oceanic `User` or `Message`:

```ts
export const inspectUser = userMenu({
  name: 'Inspect user',

  async execute(context) {
    await context.reply(`user: ${context.target.username}`)
  }
})

export const quoteMessage = messageMenu({
  name: 'Quote message',

  async execute(context) {
    await context.reply(context.target.content || '(no text)')
  }
})
```

Modal fields and route parameters are inferred from one definition:

```ts
export const editNoteModal = modal({
  customID: 'notes/edit/:noteID',
  title: 'Edit note',
  fields: {
    content: {
      kind: 'text',
      label: 'Note',
      maxLength: 1_000,
      required: true,
      style: 'paragraph'
    }
  },

  async execute(context) {
    const noteID = context.params.noteID
    const content = context.values.content
    await context.reply(`updated ${noteID}: ${content}`)
  }
})
```

Open the modal from a slash or context-menu handler:

```ts
await context.showModal(editNoteModal, {
  params: { noteID: note.id },
  values: { content: note.content }
})
```

Register all three interaction kinds together:

```ts
const registry = rosepack.createRegistry({
  messageContextMenus: [quoteMessage],
  modals: [editNoteModal],
  slashCommands,
  userContextMenus: [inspectUser]
})
```

Route parameters are URL-encoded into Discord's custom ID and decoded on submission. They are untrusted input, so authorize access to `noteID` before changing a note.

## Add prefix commands

Prefix commands use a positional schema string and a separate flag record:

```ts
const ban = prefix({
  name: 'ban',
  aliases: ['b'],
  description: 'ban a user',
  options: '[user: User] [reason?: rest]',
  flags: {
    force: {
      aliases: ['f'],
      description: 'skip confirmation',
      kind: 'boolean'
    },
    days: {
      aliases: ['d'],
      parser: 'integer'
    }
  },

  async execute(context) {
    const { user, reason } = context.options
    const suffix = reason === undefined ? '' : ` for ${reason}`
    await context.reply(
      `Would ban ${user.username} (${user.id})${suffix}${context.flags.force ? ' (forced)' : ''}`
    )
  }
})

const prefixRegistry = prefixCommands.createRegistry([ban], {
  prefixes: ['!', '?']
})

client.on('messageCreate', async (message) => {
  await prefixRegistry.dispatch({ app, message })
})
```

`[name: Parser]` is required, `[name?: Parser]` is optional, and a `rest` parser must be last. The built-in parsers are `string`, `integer`, `number`, `boolean`, `rest`, `User`, `Member`, `Role`, `Channel`, and `Mentionable`. The Oceanic-aware parsers accept IDs and the corresponding mentions.

Boolean flags understand `--force`, `--no-force`, and aliases such as `-f`. Value flags accept `--days 7` and `--days=7`; add `multiple: true` for repeated values. A bare `--` ends flag parsing. The registry ignores bot and webhook messages by default and can resolve prefixes asynchronously per message.

Prefix nodes can contain nested children, and the same `prefix` builder creates every node:

```ts
const moderation = prefix({
  name: 'moderation',
  aliases: ['mod'],
  description: 'moderation commands',
  subcommands: [
    prefix({
      name: 'users',
      description: 'user moderation',
      subcommands: [ban]
    })
  ]
})
```

For a parser that belongs to your application, define it once and pass it to the prefix scope:

```ts
const Duration = rosepack.prefixParser({
  consumption: 'token',
  parse({ fail, value }) {
    const match = /^(\d+)([smhd])$/u.exec(value)
    if (match === null) return fail('use a duration such as 30s or 5m')
    const units = { d: 86_400, h: 3_600, m: 60, s: 1 } as const
    return Number(match[1]) * units[match[2] as keyof typeof units]
  }
})

const prefixCommands = rosepack.createPrefixCommands({
  parsers: { Duration }
})
```

A schema such as `[timeout: Duration]` now supplies a `number` to the handler. Parser failures become structured `PrefixCommandParseError` values, which you can handle with `onParseError`.

## Move the bot to framework mode

The Vite plugin discovers files, assembles their command tree, validates it, and emits the generated modules used by your runtime entry. A minimal `vite.config.ts` looks like this:

```ts
import { defineConfig } from 'vite-plus'
import { rosepack } from 'rosepack/vite'

export default defineConfig({
  plugins: [
    rosepack({
      prefixCommands: {
        directory: 'src/prefix-commands',
        scope: 'src/rosepack.ts'
      },
      slashCommands: {
        directory: 'src/slash-commands'
      }
    })
  ],
  build: {
    outDir: 'dist'
  }
})
```

The plugin also discovers `src/user-context-menus`, `src/message-context-menus`, and `src/modals` unless you set one of those options to `false`. The `scope` on `prefixCommands` points at the module exporting your configured `prefixCommands` object; it is needed when you add custom parsers.

Change the bound builders in `src/rosepack.ts`:

```ts
export const { messageMenu, modal, slashFile: slash, slashSub, userMenu } = rosepack
export const prefixCommands = rosepack.createPrefixCommands()
export const { prefixFile: prefix } = prefixCommands
```

Now `src/slash-commands/ping.ts` can export the same handler without a `name` property, and `src/prefix-commands/echo.ts` can omit both `name` and the old manual command list.

## Filesystem routes and generated types

A framework command's path is its Discord route. The compact example has this shape:

```text
src/
├── rosepack.ts
├── slash-commands/
│   ├── ping.ts
│   ├── notes/
│   │   ├── _command.ts
│   │   ├── add.ts
│   │   └── show.ts
│   └── admin/
│       ├── _command.ts
│       └── server/
│           ├── _group.ts
│           └── inspect.ts
├── prefix-commands/
│   └── echo.ts
├── user-context-menus/
├── message-context-menus/
└── modals/
```

`ping.ts` becomes `/ping`; `notes/add.ts` becomes `/notes add`; and `admin/server/inspect.ts` becomes `/admin server inspect`.

For slash routes:

- A flat file exports `slash({ ... })` through the framework alias.
- A directory's `_command.ts` exports root metadata and cannot declare `subcommands`.
- A direct child file exports `slashSub({ ... })`.
- A `_group.ts` exports `slashGroup({ description })` from `rosepack`; its children export `slashSub()`.
- The path must already be a valid lowercase Discord command name. rosepack does not rewrite it.

Prefix directories use `_command.ts` for every directory node and can nest deeper than Discord slash commands, up to rosepack's 32-level prefix tree limit. Child files provide the tree, so a prefix `_command.ts` supplies metadata but not a `subcommands` array.

The plugin emits typed virtual modules:

```ts
import messageContextMenus from 'virtual:rosepack/message-context-menus'
import modals from 'virtual:rosepack/modals'
import prefixCommandList from 'virtual:rosepack/prefix-commands'
import slashCommands from 'virtual:rosepack/slash-commands'
import userContextMenus from 'virtual:rosepack/user-context-menus'
import { prefixCommands, rosepack } from './rosepack.ts'

const registry = rosepack.createCompiledRegistry({
  messageContextMenus,
  modals,
  slashCommands,
  userContextMenus
})
const prefixRegistry = prefixCommands.createCompiledRegistry(prefixCommandList, {
  prefixes: '!'
})
```

These imports are generated at build time. Their declarations, the modal route catalog, and the generated environment shim live under `.rosepack/`; include `.rosepack/**/*.d.ts` in `tsconfig.json`:

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

`src/rosepack-env.d.ts` can simply import `../.rosepack/env.d.ts`. Run `vp exec rosepack prepare` after cloning when the editor needs the generated declarations before `vp dev` or `vp build` has run.

The generated modal catalog also gives route-string autocomplete and parameter checking:

```ts
await context.showModal('notes/edit/:noteID', {
  params: { noteID: note.id }
})
```

## Develop, build, and register

The example scripts make the development and production stages explicit:

```sh
# Generate .rosepack declarations without starting the bot
vp exec rosepack prepare

# Discover, validate, generate, and run the development host
vp dev

# Bundle the runtime and the portable registration CLI
vp build

# Preview the registration diff
vp run register:dry

# Apply the registration diff, then start the built bot
vp run register
vp run start
```

`vp dev` watches command files and the module scope, regenerates virtual modules, synchronizes a development guild when `DISCORD_APPLICATION_ID`, `DISCORD_DEV_GUILD_ID`, and `DISCORD_TOKEN` are present, and restarts the exported `startRosepackApp` host when application code changes.

`vp build` writes `dist/index.mjs`, `dist/rosepack.mjs`, and `dist/commands.manifest.json`. The generated CLI compares the manifest with Discord and creates, updates, or deletes only commands previously owned by this app. That ownership is stored in `.rosepack/registration.json`, so an unrelated command is not deleted just because it is absent from this build.

Use `--guild ID` for a guild registration. The CLI's `modules list` command prints the generated module catalog without contacting Discord:

```sh
vp exec node --env-file-if-exists=.env dist/rosepack.mjs modules list
vp run register --guild 123456789012345678
```

The generated entry accepts `modules list` and `register`. The `register` command accepts `--dry-run`, `--guild`, `--cache`, and repeated `--module` options. The next section shows how module selection works.

## Guild modules

Modules let a guild enable or disable a complete set of application commands. Define the catalog once; the IDs are the values you persist and the labels are what you show in Discord:

```ts
// src/modules.ts
import { defineModules } from 'rosepack'

export const modules = defineModules({
  economy: {
    description: 'Coins, balances, and shops',
    label: '🍣 Economy'
  },
  moderation: {
    description: 'Server moderation tools',
    label: '🔨 Moderation'
  }
})
```

Bind that catalog to a persistence adapter. The adapter's `mutate` operation must be atomic across all bot processes and must return the complete state after the toggle:

```ts
import { createRosepack } from 'rosepack'
import { modules } from './modules.ts'
import type { AppContext } from './context.ts'

export const rosepack = createRosepack<AppContext>().withModules({
  catalog: modules,

  async read({ app, applicationID, guildID }) {
    return app.moduleStore.read({ applicationID, guildID })
  },
  async mutate({ app, applicationID, enabled, guildID, module }) {
    return app.moduleStore.mutate({ applicationID, enabled, guildID, module })
  },
  async readOwnedCommandKeys({ app, applicationID, guildID }) {
    return app.moduleStore.readOwnedCommandKeys({ applicationID, guildID })
  },
  async writeOwnedCommandKeys({ app, applicationID, guildID, keys }) {
    await app.moduleStore.writeOwnedCommandKeys({ applicationID, guildID, keys })
  }
})
```

The snippet assumes `AppContext.moduleStore` implements those four storage methods. `readOwnedCommandKeys` and `writeOwnedCommandKeys` let rosepack delete stale commands that it previously registered while leaving unrelated commands alone.

The next command snippets use library mode so the complete tree fits in one place. In framework mode, put the same metadata in the discovered files and let their paths supply the names.

Mark a root slash command or a context menu with a module reference. The whole root command, including its subcommands, is then guild-scoped:

```ts
export default slash({
  module: modules.economy,
  name: 'shop',
  description: 'buy something from the server shop',

  async execute(context) {
    await context.reply('shop')
  }
})
```

A modular command is omitted from `registry.payload` and global registration. When you enable or sync its guild, rosepack reconciles every modular slash command, user menu, and message menu in that guild.

Use `moduleChoices` to keep a module-management command tied to the catalog's exact ID union:

```ts
import { moduleChoices } from 'rosepack'

const moduleOption = {
  choices: moduleChoices(modules),
  description: 'which module to change',
  kind: 'string',
  required: true
} as const

export default slash({
  name: 'modules',
  description: 'manage server modules',
  contexts: ['guild'],
  installations: ['guild'],
  subcommands: {
    enable: slashSub({
      description: 'enable a module',
      options: { module: moduleOption },

      async execute(context) {
        const result = await context.modules.enable(context.options.module)
        await context.reply(
          result.changed
            ? `enabled ${result.module.label}`
            : `${result.module.label} is already enabled`
        )
      }
    }),
    disable: slashSub({
      description: 'disable a module',
      options: { module: moduleOption },

      async execute(context) {
        const result = await context.modules.disable(context.options.module)
        await context.reply(
          result.changed
            ? `disabled ${result.module.label}`
            : `${result.module.label} is already disabled`
        )
      }
    })
  }
})
```

The `as const` on the option is needed here because the object is shared between two definitions; an inline object infers the same type without it. In either handler, `context.options.module` is `'economy' | 'moderation'`.

The interaction context exposes `enable`, `disable`, `list`, and `isEnabled`. Enabling or disabling persists the desired state, reconciles the guild, and returns `changed`, `enabled`, `module`, and registration results. A module context is guild-only.

Repair remote state after a deploy:

```ts
await registry.modules.sync({
  app,
  applicationID: client.application.id,
  client,
  guildID
})

await registry.modules.syncAll({
  app,
  applicationID: client.application.id,
  client,
  guildIDs
})
```

`syncAll` accepts an optional `concurrency` limit. A failed Discord reconciliation is wrapped in `ModuleSynchronizationError` with the application, guild, and desired module IDs. If an interaction arrives after a module is disabled, rosepack skips the handler and calls the adapter's optional `onDisabled` hook so you can send an explanatory response.

In framework mode, point the plugin at the catalog export as well as binding the runtime adapter:

```ts
rosepack({
  modules: {
    scope: 'src/modules.ts'
  }
})
```

The plugin validates module references during discovery and puts the catalog in the build manifest. It does not replace your persistence adapter.

The production CLI can inspect or select catalog entries:

```sh
vp exec node --env-file-if-exists=.env dist/rosepack.mjs modules list
vp run register --guild 123456789012345678 --module economy --module moderation
```

`--module` requires `--guild` and may be repeated. A global registration never includes modular commands; a guild registration with no module filter includes the full manifest, while a filtered registration includes only the selected module commands.

## Receive interactions over HTTP

Gateway mode is not required for slash commands, context menus, and modals. `createHttpInteractionHandler` accepts a Fetch-compatible `Request` and verifies Discord's Ed25519 signature before it parses the body:

```ts
import { Hono } from 'hono'
import { Client } from 'oceanic.js'
import { createHttpInteractionHandler } from 'rosepack/http'

const client = new Client({ auth: `Bot ${token}` })
await client.restMode(false)

const handleInteraction = createHttpInteractionHandler({
  app,
  client,
  publicKey,
  registry
})

const api = new Hono()
api.post('/interactions', (context) => handleInteraction(context.req.raw))
```

A Discord `PING` gets a `PONG` response immediately. Commands, context menus, and modal submissions are hydrated into Oceanic interactions and sent through `registry.dispatch`; an acknowledged request ends with HTTP 204. Set `onUnhandledInteraction` for autocomplete and component interactions, which rosepack deliberately leaves to your application.

Prefix commands still need the Gateway's message events. The complete signed Hono setup is in the [HTTP example](examples/http).

## Inspect, invoke, and validate commands

A registry is also a read-only command index:

```ts
const pingNode = registry.get('ping')
const notesLeaf = registry.resolve('/notes admin clear')
const allRoots = registry.tree
```

`get` accepts a root name or the original definition object. `resolve` accepts a slash-style string or an array of path segments. Each node exposes its `name`, `description`, `path`, `children`, `executable`, and original `definition`.

From a slash handler, invoke another executable definition without reparsing Discord input:

```ts
await context.invoke(pingCommand, {})
```

rosepack validates the target's options, preserves its hooks, and rejects recursive invocation. Prefix handlers have the corresponding `context.invoke(target, { options, flags })` API.

For tooling or tests, inspect a tree without constructing a registry:

```ts
import { lintSlashCommandTree, slashCommandToDiscord } from 'rosepack'

const issues = lintSlashCommandTree(commands)
if (issues.length > 0) {
  console.error(issues)
}

const payload = slashCommandToDiscord(commands[0]!)
```

`lintSlashCommandTree` returns stable issue codes, paths, and messages. `slashCommandToDiscord` validates one root and returns the Oceanic registration payload; neither function sends a request. The [starter example](examples/starter) puts these pieces together with a larger command tree.
