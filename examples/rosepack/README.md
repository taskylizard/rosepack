# rosepack framework example

A small but complete Oceanic bot showing slash commands, user and message context menus, typed
modal routes, inferred fields, subcommands, application context, registration, and interaction
dispatch.

## Setup

From the repository root:

```sh
vp install
cd examples/rosepack
cp .env.example .env
```

Replace `replace-me` with your Discord bot token. The application must have the `applications.commands` and `bot` scopes when installed.

Generate editor declarations without starting or building the bot with `vp exec rosepack prepare`.

## Framework development

```sh
vp run dev
```

the Vite plugin discovers slash commands, context menus, modals, and prefix commands, generates
exact declarations under <code>.rosepack</code>, validates them, and reconciles application commands
into <code>DISCORD_DEV_GUILD_ID</code>. detailed traces are opt-in:

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
