import { slashSub } from '../../../framework.ts'

export default slashSub({
  description: 'Demonstrate unbanning a user',
  options: {
    user: {
      description: 'The ID of the user to unban',
      kind: 'string',
      required: true
    }
  },

  async execute(context) {
    await context.reply(`Would unban <@${context.options.user}>.`)
  }
})
