import { slash } from '../framework.ts'

export default slash({
  description: 'check whether the HTTP interaction endpoint is responding',

  async execute(context) {
    const uptime = Math.round((Date.now() - context.app.startedAt) / 1_000)
    await context.reply(`Pong from Hono! HTTP process uptime: ${uptime}s`)
  }
})
