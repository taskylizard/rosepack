# rosepack library example

A small, complete Oceanic bot using rosepack as a library. There is no build tool: plain
TypeScript runs directly in Node.js with type stripping.

This example demonstrates creating a rosepack instance, defining slash and prefix commands in
one file, building registries with `createRegistry` and `prefixCommands.createRegistry`, globally
registering slash commands, and dispatching interactions and messages.

## Setup

From the repository root:

```sh
vp install
cd examples/library
cp .env.example .env
```

Replace both `replace-me` values with your Discord bot token and application ID. The application
must have the `applications.commands` and `bot` scopes when installed. Prefix commands also need
the Message Content privileged intent enabled in the Discord developer portal.

Run the bot with either package manager:

```sh
pnpm start
# or
npm start
```

Global command updates can take time to appear in Discord. Starting the bot bulk-overwrites the
application's global commands with the slash commands in this example.
