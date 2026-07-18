# HTTP Mode

This example receives Discord interactions over HTTP with Hono. It does not connect to the Discord
Gateway or request gateway intents.

## Setup

Create `.env`:

```dotenv
DISCORD_TOKEN=your-bot-token
DISCORD_APPLICATION_ID=your-application-id
DISCORD_PUBLIC_KEY=your-application-public-key
DISCORD_DEV_GUILD_ID=your-development-guild-id
PORT=3000
```

The application ID and public key are on the Discord Developer Portal's **General Information**
page. The token is on the **Bot** page.

## Development

```sh
vp dev
```

Expose `http://localhost:3000/interactions` through an HTTPS tunnel, then use that URL as the
application's **Interactions Endpoint URL**.

When the development variables are set, rosepack synchronizes commands to
`DISCORD_DEV_GUILD_ID`.

## Build and run

```sh
vp build
vp run register
vp run start
```

## How it works

`createHttpInteractionHandler` verifies Discord requests, responds to PINGs, creates Oceanic
interaction objects, and dispatches them to the rosepack registry. Oceanic sends the interaction
response, then Hono returns HTTP 204.

The main wiring is in `src/app.ts`. The command in `src/slash-commands/ping.ts` uses the same
rosepack API as a Gateway bot.

Prefix commands require the Gateway. Use `onUnhandledInteraction` for autocomplete and component
interactions.
