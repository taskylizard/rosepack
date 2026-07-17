import { createApp } from './app.ts'

export async function startRosepackApp(context: {
  readonly environment: Readonly<Record<string, string | undefined>>
}) {
  const token = context.environment.DISCORD_TOKEN
  if (token === undefined) {
    throw new Error('Set DISCORD_TOKEN before starting the example bot.')
  }
  const app = createApp(token)
  await app.start()
  return { stop: app.stop }
}

if (process.env.NODE_ENV !== 'development') {
  await startRosepackApp({ environment: process.env })
}
