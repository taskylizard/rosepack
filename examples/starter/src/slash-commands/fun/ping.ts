import { slash } from '../../framework.ts'

const pingCommand = slash({
  name: 'ping',
  description: 'Check whether the bot is responding',
  contexts: ['guild', 'botDm', 'privateChannel'],
  installations: ['guild', 'user'],

  async execute(context) {
    const latency = context.app.client.shards.get(0)?.latency
    await context.reply(`Pong! 🏓 Gateway latency: ${latency ?? 'unknown'} ms`)
  }
})

export default pingCommand
