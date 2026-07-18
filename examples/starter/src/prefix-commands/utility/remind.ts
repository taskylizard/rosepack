import { prefix } from '../../framework.ts'

export default prefix({
  description: 'Save an in-memory reminder',
  options: '[duration: Duration] [content: rest]',

  async execute(context) {
    const count = context.app.reminders.add(
      context.message.author.id,
      context.options.duration,
      context.options.content
    )
    await context.reply(`Saved reminder ${count} for ${context.options.duration} seconds from now.`)
  }
})
