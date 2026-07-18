import { prefix } from '../../framework.ts'

export default prefix({
  description: 'Check whether the bot is responding',
  async execute(context) {
    await context.reply('Pong! 🏓')
  }
})
