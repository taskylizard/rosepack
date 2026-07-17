import { slash, slashSub } from '../../framework.ts'

export default slash({
  name: 'moderation',
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
  },

  subcommands: {
    user: {
      description: 'Moderate a user',
      subcommands: {
        ban: slashSub({
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
        }),
        unban: slashSub({
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
      }
    }
  }
})
