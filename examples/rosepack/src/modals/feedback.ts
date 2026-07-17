import { modal } from '../framework.ts'

export default modal({
  customID: 'feedback/:source',
  title: 'Send feedback',

  fields: {
    feedback: {
      kind: 'text',
      label: 'Feedback',
      maxLength: 2_000,
      required: true,
      style: 'paragraph'
    }
  },

  async execute(context) {
    await context.reply(
      `Received ${context.values.feedback.length} characters from ${context.params.source}.`
    )
  }
})
