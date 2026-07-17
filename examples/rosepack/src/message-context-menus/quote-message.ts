import { messageMenu } from '../framework.ts'

export default messageMenu({
  name: 'Quote message',

  async execute(context) {
    await context.reply(context.target.content || '(message has no textual content)')
  }
})
