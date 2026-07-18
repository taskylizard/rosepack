import { slash } from '../framework.ts'

export default slash({
  description: 'Open the feedback form',

  async execute(context) {
    await context.showModal('feedback/:source', {
      params: { source: 'slash-command' }
    })
  }
})
