import { prefix } from '../../framework.ts'

export default prefix({
  description: 'Roll a die',
  flags: {
    verbose: {
      aliases: ['v'],
      description: 'Show the roll range',
      kind: 'boolean'
    }
  },
  options: '[sides?: integer]',

  async execute(context) {
    const sides = context.options.sides ?? 6
    if (sides < 2) {
      await context.reply('A die needs at least two sides.')
      return
    }
    const result = Math.floor(Math.random() * sides) + 1
    await context.reply(
      context.flags.verbose ? `Rolled 1d${sides}: **${result}** (range 1–${sides})` : `🎲 ${result}`
    )
  }
})
