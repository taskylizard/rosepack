import { prefix } from '../../framework.ts'

export default prefix({
  aliases: ['b'],
  description: 'Ban a user from this server',
  flags: {
    force: {
      aliases: ['f'],
      description: 'Skip confirmation',
      kind: 'boolean'
    }
  },
  name: 'ban',
  options: '[user: User] [reason?: rest]',

  async execute(context) {
    const { user, reason } = context.options
    await context.reply(
      `Would ban ${user.username} (${user.id})${reason ? ` for: ${reason}` : ''}${context.flags.force ? ' (forced)' : ''}`
    )
  }
})
