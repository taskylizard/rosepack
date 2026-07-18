import { slashSub } from '../../../framework.ts'

export default slashSub({
  description: 'Save a new note',
  options: {
    content: {
      description: 'The note you want to save',
      kind: 'string',
      maxLength: 1_000,
      required: true
    }
  },

  async execute(context) {
    const count = context.app.notes.add(context.interaction.user.id, context.options.content)
    await context.reply(`Saved note ${count}.`)
  }
})
