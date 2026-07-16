import { prefix } from '../framework.ts'

export default prefix({
  aliases: ['say'],
  description: 'Repeat some text',
  flags: {
    uppercase: {
      aliases: ['u'],
      description: 'Uppercase the response',
      kind: 'boolean'
    }
  },
  name: 'echo',
  options: '[text: rest]',

  async execute(context) {
    const text = context.flags.uppercase
      ? context.options.text.toLocaleUpperCase()
      : context.options.text
    await context.reply(text)
  }
})
