import { slashSub } from '../../../framework.ts'

export default slashSub({
  description: 'Inspect the current server',

  async execute(context) {
    const { guildID, memberPermissions } = context.interaction
    await context.reply(
      `Server ${guildID}; can manage: ${memberPermissions?.has('MANAGE_GUILD') === true}`
    )
  }
})
