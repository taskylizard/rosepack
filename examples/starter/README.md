# rosepack framework starter

A fully-fledged starter app showcasing every rosepack feature in framework mode.

## Features

- Filesystem-discovered slash and prefix commands with compile-time tree validation
- Flat commands, typed options, choices, subcommands, and slash subcommand groups
- Prefix positional parsers, flags, nested routing, and a custom `Duration` parser
- Typed application services, lifecycle hooks, response helpers, and command invocation
- Development-guild synchronization and supervised hot-module restarts
- Production bundles and incremental, ownership-aware command registration

## Setup

From the repository root:

```sh
vp install
cd examples/starter
cp .env.example .env
```

Set `DISCORD_TOKEN` to the bot token, `DISCORD_APPLICATION_ID` to its application ID, and
`DISCORD_DEV_GUILD_ID` to a test guild where commands may be synchronized during development.
Install the application with the `bot` and `applications.commands` scopes. Prefix commands also
require the Message Content privileged intent in the Discord developer portal.

## Development

```sh
vp dev
```

The plugin discovers files under `src/commands/` and `src/prefix-commands/`, validates their
trees, and reconciles slash commands into `DISCORD_DEV_GUILD_ID` whenever they change. The dev
host calls `startRosepackApp` from `src/index.ts`; source changes stop the old client and start the
updated module. Enable detailed traces with:

```sh
DEBUG=rosepack:* vp dev
```

## Build and deploy

```sh
vp build
vp run register:dry
vp run register
vp run start
```

The build emits the bot at `dist/index.mjs`, the registration CLI at `dist/rosepack.mjs`, a command
manifest, and native assets. `register:dry` previews changes. `register` incrementally creates,
updates, and deletes only commands owned by this app instead of destructively bulk-overwriting all
application commands; ownership is tracked in `.rosepack/registration.json`. Pass `--guild ID` for
guild registration or `--cache FILE` to choose another cache.

## Project structure

```text
src/
├── app.ts                         Oceanic client, compiled registries, and event wiring
├── context.ts                     Typed application context and in-memory services
├── framework.ts                   Bound builders and custom Duration prefix parser
├── index.ts                       Development supervisor and production entry point
├── rosepack-virtual.d.ts          Type declarations for generated virtual modules
├── commands/
│   ├── fun/
│   │   ├── eightball.ts           Magic 8-ball with a required string option
│   │   ├── greet.ts               Typed options and string choices
│   │   └── ping.ts                Flat slash command with gateway latency
│   ├── moderation/
│   │   └── moderation.ts          Slash subcommand group and permission hook
│   └── utility/
│       ├── notes.ts               Subcommands, services, deferral, and error handling
│       ├── serverinfo.ts          Guild-only command showing server details
│       └── stats.ts               Stats service and cross-command invocation
└── prefix-commands/
    ├── fun/
    │   ├── echo.ts                Rest positional option and boolean flag
    │   ├── eightball.ts           Magic 8-ball with a rest option
    │   └── roll.ts                Optional integer and verbose flag
    ├── moderation/
    │   ├── ban.ts                 User parser, optional rest reason, and --force flag
    │   └── purge.ts               Required integer count and --silent flag
    └── utility/
        ├── ping.ts                Prefix parity with the slash ping command
        ├── remind.ts              Custom Duration parser with a rest option
        └── tools.ts               Prefix subcommand routing
```

Commands are discovered **recursively** — drop a file into any nested folder under `src/commands/`
or `src/prefix-commands/` and it is picked up automatically. No command list needs manual
maintenance, and the virtual imports in `app.ts` are already compile-time validated, so they use
`createCompiledRegistry`.

## Feature walkthrough

### Flat slash command

`src/commands/fun/ping.ts` is the smallest complete command and reports gateway latency.

### Slash options and choices

`src/commands/fun/greet.ts` has an optional typed user ID and a `style` string option constrained to
`brief`, `warm`, or `excited`. Omitted user IDs default to the invoker.

### Slash subcommands

`src/commands/utility/notes.ts` defines executable `notes add` and `notes list` leaves with `slashSub()`.
The add option and service calls remain fully inferred.

### Slash subcommand groups

`src/commands/moderation/moderation.ts` models Discord's required group shape: `moderation user ban` and
`moderation user unban`. The `user` node is a plain `{ description, subcommands }` group.

### Lifecycle hooks

`src/commands/utility/notes.ts` uses `beforeExecute` to defer ephemerally and `onError` to log and replace
the deferred response. `src/commands/moderation/moderation.ts` uses the same hooks for a permission guard.

### Prefix positional options

`src/prefix-commands/fun/echo.ts` parses `!echo [text: rest]`; quoted arguments and escapes are handled
by the registry. Try `!echo hello world`.

### Prefix flags

`src/prefix-commands/fun/roll.ts` parses an optional integer in `!roll [sides?: integer]` and supports
`--verbose` or `-v`. `echo` similarly supports `--uppercase`, `--no-uppercase`, and `-u`.
`src/prefix-commands/moderation/purge.ts` adds a `--silent`/`-s` flag, and
`src/prefix-commands/moderation/ban.ts` shows `--force`/`-f`.

### Prefix subcommands

`src/prefix-commands/utility/tools.ts` routes to executable `!tools serverinfo` and
`!tools userinfo [user: User]` children. Prefix trees may continue nesting up to 32 levels.

### Custom prefix parser

`src/framework.ts` defines a token-consuming `Duration` parser with `rosepack.prefixParser()` and
registers it in the scoped prefix builders. `src/prefix-commands/utility/remind.ts` then infers a number
from values such as `30s`, `5m`, `2h`, and `1d`.

### App context and services

`src/context.ts` provides `NotesService`, `ReminderService`, and `StatsService`. `src/app.ts` creates
one context, and `createRosepack<AppContext>()` makes every command receive those typed services.

### Response helpers

`src/commands/utility/notes.ts` demonstrates `defer()` followed by `reply()`; reply seamlessly edits an
already deferred response. `src/commands/utility/stats.ts` also uses `followUp()` after its first response.
Contexts additionally expose `editResponse()` and `deleteResponse()`.

### Command invocation

`src/commands/utility/stats.ts` imports the ping definition and calls `context.invoke(pingCommand, {})`.
Invocation preserves hooks and validates the target's option values without reparsing an event.

## Validate

From this directory:

```sh
vp run check
vp run test
vp run build
```

These validate formatting, linting, types, tests, plugin command trees, and the production bundle.
