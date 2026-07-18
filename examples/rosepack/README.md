# Framework Mode

This example uses the `rosepack/vite` plugin for command discovery, validation, development sync,
hot restarts, and production builds.

## Setup

Create `.env`:

```dotenv
DISCORD_TOKEN=your-bot-token
DISCORD_APPLICATION_ID=your-application-id
DISCORD_DEV_GUILD_ID=your-development-guild-id
```

Install the application with the `bot` and `applications.commands` scopes. Prefix commands also
require the Message Content privileged intent.

Generate editor types without starting the app:

```sh
vp exec rosepack prepare
```

## Development

```sh
vp dev
```

rosepack discovers commands and modals, writes types to `.rosepack`, validates definitions, and
synchronizes application commands to `DISCORD_DEV_GUILD_ID`.

Use `DEBUG=rosepack:* vp dev` for detailed logs.

## Build and run

```sh
vp build
vp run register:dry
vp run register
vp run start
```

The build writes the bot to `dist/index.mjs` and the registration CLI to `dist/rosepack.mjs`.

## Validate

```sh
vp run check
vp run test
vp run build
```
