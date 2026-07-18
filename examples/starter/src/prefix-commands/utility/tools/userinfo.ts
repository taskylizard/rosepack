import { prefix } from '../../../framework.ts'

export default prefix({
  description: 'Show information about a user',
  options: '[user: User]',

  async execute(context) {
    await context.reply(`${context.options.user.username} (${context.options.user.id})`)
  }
})
