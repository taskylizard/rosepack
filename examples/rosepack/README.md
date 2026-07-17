# rosepack example

A small but complete Oceanic bot showing flat commands, inferred options, subcommands, subcommand groups, application context, lifecycle hooks, registration, and interaction dispatch.

## Setup

From the repository root:

```sh
vp install
cd examples/rosepack
cp .env.example .env
```

Replace `replace-me` with your Discord bot token. The application must have the `applications.commands` and `bot` scopes when installed.

## Framework development

```sh
vp run dev
```

the vite plugin discovers slash and prefix commands, validates them, and attempts to reconcile
slash commands into <code>DISCORD_DEV_GUILD_ID</code>. detailed traces are opt-in:

```sh
DEBUG=rosepack:* vp run dev
```

the bot is supervised through the <code>startRosepackApp</code> export in
<code>src/index.ts</code>. source changes stop the previous client and start the updated module.
existing shell variables override <code>.env.local</code>; unset conflicting Discord variables when
switching between projects

## Build with vite

vite produces a portable server bundle, registration cli, command manifest, and native assets:

```sh
vp run build
vp run register:dry
vp run register
vp run start
```

the bot entry is <code>dist/index.mjs</code> and the registration cli is
<code>dist/rosepack.mjs</code>.

## Validate

```sh
vp run check
vp run test
vp run build
```

The example owns its package configuration and dependencies, so it can also be copied out of the monorepo after replacing the `workspace:*` rosepack dependency with a published version.
