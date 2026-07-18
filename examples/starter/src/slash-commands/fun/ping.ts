import { slashSub } from '../../framework.ts'

const pingCommand = slashSub({
  description: 'Check whether the bot is responding',

  async execute(context) {
    const latency = context.app.client.shards.get(0)?.latency
    await context.reply(`Pong! 🏓 Gateway latency: ${latency ?? 'unknown'} ms`)
  }
})

export default pingCommand
