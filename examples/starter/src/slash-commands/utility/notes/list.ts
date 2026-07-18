import { slashSub } from '../../../framework.ts'

export default slashSub({
  description: 'List your saved notes',

  async execute(context) {
    const notes = context.app.notes.list(context.interaction.user.id)
    await context.reply(
      notes.length === 0
        ? 'You have no saved notes.'
        : notes.map((note, index) => `${index + 1}. ${note}`).join('\n')
    )
  }
})
