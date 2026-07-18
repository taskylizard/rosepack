import { slash } from '../../framework.ts'

export default slash({
  description: 'Demonstrate grouped moderation commands',
  contexts: ['guild'],
  installations: ['guild'],

  async beforeExecute(context) {
    if (context.interaction.memberPermissions?.has('BAN_MEMBERS') !== true) {
      await context.defer({ ephemeral: true })
      throw new Error('This command requires the Ban Members permission.')
    }
  },

  async onError(context, error) {
    const message = error instanceof Error ? error.message : 'The moderation command failed.'
    await context.reply(message)
  }
})
