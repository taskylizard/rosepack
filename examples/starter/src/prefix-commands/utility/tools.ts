import { prefix } from '../../framework.ts'

const serverInfo = prefix({
  description: 'Show information about this server',
  name: 'serverinfo',

  async execute(context) {
    const guild = context.message.guildID
      ? context.message.client.guilds.get(context.message.guildID)
      : undefined
    await context.reply(guild ? `${guild.name} (${guild.id})` : 'This message is not in a server.')
  }
})

const userInfo = prefix({
  description: 'Show information about a user',
  name: 'userinfo',
  options: '[user: User]',

  async execute(context) {
    await context.reply(`${context.options.user.username} (${context.options.user.id})`)
  }
})

export default prefix({
  description: 'Useful server and user tools',
  name: 'tools',
  subcommands: [serverInfo, userInfo]
})
