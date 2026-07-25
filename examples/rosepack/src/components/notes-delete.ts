import { button } from '../framework.ts'

export default button({
  customID: 'notes/:noteID/delete',

  async execute(context) {
    await context.deferUpdate()
    await context.editParent(`deleted note ${context.params.noteID}`)
  }
})
