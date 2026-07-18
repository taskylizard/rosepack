# Library Mode

This example uses rosepack without the Vite plugin. Commands, registries, registration, and event
wiring live in one TypeScript file.

## Setup

Create `.env`:

```dotenv
DISCORD_TOKEN=your-bot-token
DISCORD_APPLICATION_ID=your-application-id
```

Install the application with the `bot` and `applications.commands` scopes. Prefix commands also
require the Message Content privileged intent.

## Run

```sh
vp run start
```

The example registers global application commands when it starts. Global updates may take time to
appear in Discord.

## What it shows

- Slash commands
- User and message context menus
- A routed modal
- Prefix commands
- Manual registry construction and dispatch
