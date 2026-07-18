import { prefix } from '../../../framework.ts'

export default prefix({
  description: 'Show information about this server',

  async execute(context) {
    const guild = context.message.guildID
      ? context.message.client.guilds.get(context.message.guildID)
      : undefined
    await context.reply(guild ? `${guild.name} (${guild.id})` : 'This message is not in a server.')
  }
})
