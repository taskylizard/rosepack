import { slashSub } from '../../framework.ts'

export default slashSub({
  description: 'Show information about this server',

  async execute(context) {
    const guildID = context.interaction.guildID
    if (guildID === null) {
      await context.reply('This command can only be used in a server.')
      return
    }
    const guild = context.client.guilds.get(guildID)
    if (guild === undefined) {
      await context.reply('Could not fetch server information.')
      return
    }
    await context.reply(`${guild.name ?? 'Unnamed server'} (${guild.id})`)
  }
})
