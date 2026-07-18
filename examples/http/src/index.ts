import { createApp } from './app.ts'

export async function startRosepackApp(context: {
  readonly environment: Readonly<Record<string, string | undefined>>
}) {
  const publicKey = context.environment.DISCORD_PUBLIC_KEY
  const token = context.environment.DISCORD_TOKEN
  if (publicKey === undefined || token === undefined) {
    throw new Error('Set DISCORD_PUBLIC_KEY and DISCORD_TOKEN before starting the HTTP bot.')
  }
  const port = Number(context.environment.PORT ?? 3_000)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer from 1 through 65535.')
  }
  const app = createApp({ port, publicKey, token })
  await app.start()
  return { stop: () => app.stop() }
}

if (process.env.NODE_ENV !== 'development') {
  await startRosepackApp({ environment: process.env })
}
