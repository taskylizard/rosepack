# Framework Starter

This example shows the full rosepack framework workflow with slash commands, prefix commands,
typed services, command registration, and hot restarts.

## Setup

Create `.env`:

```dotenv
DISCORD_TOKEN=your-bot-token
DISCORD_APPLICATION_ID=your-application-id
DISCORD_DEV_GUILD_ID=your-development-guild-id
```

Install the application with the `bot` and `applications.commands` scopes. Prefix commands also
require the Message Content privileged intent.

## Development

```sh
vp dev
```

rosepack discovers files under `src/slash-commands` and `src/prefix-commands`, validates their
trees, generates types, and synchronizes slash commands to `DISCORD_DEV_GUILD_ID`.

Source changes restart the Oceanic client through `startRosepackApp`. Use
`DEBUG=rosepack:* vp dev` for detailed logs.

## Build and run

```sh
vp build
vp run register:dry
vp run register
vp run start
```

`register:dry` previews command changes. `register` creates, updates, and deletes commands owned by
this app. Registration state is stored in `.rosepack/registration.json`.

Use `--guild ID` for guild registration or `--cache FILE` to choose another cache file.

## Project map

```text
src/
├── app.ts                 Oceanic client and registry wiring
├── context.ts             Typed services
├── framework.ts           Bound builders and custom parsers
├── index.ts               Development and production entry point
├── slash-commands/        Slash commands and context-driven features
└── prefix-commands/       Prefix commands, flags, and nested routing
```

Command files are discovered recursively. Generated virtual modules provide exact command tuples,
so `app.ts` can use `createCompiledRegistry` without manual command lists.

## Slash commands

| Feature                                | Example                                   |
| -------------------------------------- | ----------------------------------------- |
| Flat command                           | `slash-commands/fun/ping.ts`              |
| Typed options and choices              | `slash-commands/fun/greet.ts`             |
| Subcommands and services               | `slash-commands/utility/notes.ts`         |
| Subcommand groups and permission hooks | `slash-commands/moderation/moderation.ts` |
| Cross-command invocation               | `slash-commands/utility/stats.ts`         |
| Guild context                          | `slash-commands/utility/serverinfo.ts`    |

`notes.ts` also shows ephemeral deferral and error handling. `stats.ts` uses `followUp()` and
`context.invoke()`.

## Prefix commands

| Feature                              | Example                               |
| ------------------------------------ | ------------------------------------- |
| Rest options and boolean flags       | `prefix-commands/fun/echo.ts`         |
| Optional values and short flags      | `prefix-commands/fun/roll.ts`         |
| Oceanic user parsing                 | `prefix-commands/moderation/ban.ts`   |
| Required values and silent responses | `prefix-commands/moderation/purge.ts` |
| Nested subcommands                   | `prefix-commands/utility/tools.ts`    |
| Custom `Duration` parser             | `prefix-commands/utility/remind.ts`   |

The `Duration` parser is defined in `src/framework.ts`. Values such as `30s`, `5m`, `2h`, and `1d`
are inferred as numbers in command handlers.

## Validate

```sh
vp run check
vp run test
vp run build
```
