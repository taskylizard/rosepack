import { slash } from '../../framework.ts'

export default slash({
  description: 'Save and review personal notes',
  contexts: ['guild', 'botDm', 'privateChannel'],
  installations: ['guild', 'user'],

  async beforeExecute(context) {
    await context.defer({ ephemeral: true })
  },

  async onError(context, error) {
    console.error('The notes command failed.', error)
    await context.editResponse('Something went wrong while handling your notes.')
  }
})
