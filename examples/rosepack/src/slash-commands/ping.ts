import { slash } from '../framework.ts'

export default slash({
  name: 'ping',
  description: 'Check whether the bot is responding',
  contexts: ['guild', 'botDm', 'privateChannel'],
  installations: ['guild', 'user'],

  async execute(context) {
    await context.reply('Pong! meow gaming!')
  }
})
