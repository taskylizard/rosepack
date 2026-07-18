import { prefix } from '../../framework.ts'

export default prefix({
  aliases: ['clear'],
  description: 'Delete multiple messages at once',
  flags: {
    silent: {
      aliases: ['s'],
      description: 'Suppress the confirmation message',
      kind: 'boolean'
    }
  },
  options: '[count: integer]',

  async execute(context) {
    const { count } = context.options
    if (count < 1 || count > 100) {
      await context.reply('Provide a count between 1 and 100.')
      return
    }
    if (context.flags.silent) {
      return
    }
    await context.reply(`Would delete ${count} messages.`)
  }
})
