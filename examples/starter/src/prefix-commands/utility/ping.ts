import { prefix } from '../../framework.ts'

export default prefix({
  description: 'Check whether the bot is responding',
  name: 'ping',

  async execute(context) {
    await context.reply('Pong! 🏓')
  }
})
