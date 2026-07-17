import { userMenu } from '../framework.ts'

export default userMenu({
  name: 'Inspect user',

  async execute(context) {
    await context.reply(`Selected user: ${context.target.username} (${context.target.id})`)
  }
})
