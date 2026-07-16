# rosepack

rosepack is a typed slash-command framework for
[oceanic](https://oceanic.ws). command definitions stay next to their handlers,
options infer into <code>context.options</code>, and the whole tree gets checked before
it goes near discord. the registry keeps that tree around too, so lookup and
command-to-command calls use the same source.

> [!NOTE]
> the package on npm is still the old build. <code>main</code> has not been released yet

## install

```sh
vp add rosepack oceanic.js
```

needs node.js 22 or newer. <code>oceanic.js</code> is a peer dependency, your app
should own that version

## set up rosepack

bind your app services once, then import the helpers wherever your commands live

```ts
import { createRosepack } from 'rosepack'

interface AppContext {
  notes: NotesService
}

export const rosepack = createRosepack<AppContext>()
export const { slashCommand, subcommand } = rosepack
```

<code>context.app</code> is the exact <code>AppContext</code> passed to
<code>registry.dispatch</code>. no hidden service container or other weirdness

## define a command

```ts
import { slashCommand } from '../rosepack.ts'

export default slashCommand({
  name: 'ping',
  description: 'check whether the bot is responding',
  contexts: ['guild', 'botDm', 'privateChannel'],
  installations: ['guild', 'user'],

  async execute(context) {
    await context.reply('pong')
  }
})
```

rosepack turns those readable context and installation names into discord's numeric
values when it builds the registration payload

## options

options infer directly onto <code>context.options</code>. required values stay required,
and choices become literal unions. nice and boring

```ts
export default slashCommand({
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

## subcommands and groups

use <code>subcommand()</code> for executable leaves. plain nested objects are discord
subcommand groups

```ts
export default slashCommand({
  name: 'notes',
  description: 'manage notes',
  subcommands: {
    add: subcommand({
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
        clear: subcommand({
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

discord only allows command → group → subcommand. the types stop deeper groups,
executable groups, root handlers on routed commands, empty groups, and leaves made
without <code>subcommand()</code>. the registry checks the same stuff at runtime

## hooks and responses

commands can define <code>beforeExecute(context)</code> and
<code>onError(context, error)</code>

response helpers are <code>defer</code>, <code>reply</code>,
<code>editResponse</code>, <code>followUp</code>, and
<code>deleteResponse</code>

<code>reply</code> creates the first response or edits the original one after a defer.
means less annoying acknowledgement-state branching in every handler

## register and dispatch

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

<code>dispatch</code> ignores interactions that are not commands. unknown chat-input
commands call <code>onUnknownCommand</code> when you configure it

## inspect and invoke commands

<code>registry.tree</code> is an immutable view of every command node. find commands
with <code>registry.get('ping')</code>, <code>registry.get(commandDefinition)</code>,
or <code>registry.resolve('/notes admin clear')</code>

inside a handler, the registry is on <code>context.registry</code>.
<code>context.command</code> is the root node and <code>context.node</code> is the
selected leaf

invoke another registered executable definition or node like this

```ts
await context.invoke(otherCommand, {
  requiredOption: 'value'
})
```

the options still get validated and recursive calls are rejected. infinite command
loops are funny once

## validation

<code>createRegistry</code> throws <code>CommandTreeValidationError</code> before any
discord api call when the tree is invalid. its <code>issues</code> property has stable
codes, paths, and readable messages

<code>lintSlashCommandTree(commands)</code> returns the issues without throwing.
<code>slashCommandToDiscord(command)</code> builds one validated discord payload

## api

main exports:

- <code>createRosepack</code>
- <code>SlashCommandContext</code>
- <code>SlashCommandRegistry</code>
- <code>CommandTreeValidationError</code>
- <code>lintSlashCommandTree</code>
- <code>slashCommandToDiscord</code>
- the command, option, and tree types

there is a complete small bot in
[<code>examples/rosepack</code>](./examples/rosepack/src)

## development

use vite+ for the repo workflow

```sh
vp install
vp run -r check
vp run -r test
vp run -r build
```

release setup and trusted publishing live in
[<code>docs/releasing.md</code>](./docs/releasing.md)
