import { slashSub } from '../../../framework.ts'

export default slashSub({
  description: 'Demonstrate banning a user',
  options: {
    reason: {
      description: 'Why this user should be banned',
      kind: 'string',
      maxLength: 512
    },
    user: {
      description: 'The ID of the user to ban',
      kind: 'string',
      required: true
    }
  },

  async execute(context) {
    await context.reply(
      `Would ban <@${context.options.user}>: ${context.options.reason ?? 'No reason given'}`
    )
  }
})
