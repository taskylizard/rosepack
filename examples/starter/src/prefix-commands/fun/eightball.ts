import { prefix } from '../../framework.ts'

const responses = [
  'It is certain.',
  'Without a doubt.',
  'Yes, definitely.',
  'Reply hazy, try again.',
  'Ask again later.',
  "Don't count on it.",
  'My sources say no.',
  'Very doubtful.'
] as const

export default prefix({
  aliases: ['8ball'],
  description: 'Ask the magic 8-ball a yes-or-no question',
  name: 'eightball',
  options: '[question: rest]',

  async execute(context) {
    const answer = responses[Math.floor(Math.random() * responses.length)]
    await context.reply(`🎱 ${answer}`)
  }
})
