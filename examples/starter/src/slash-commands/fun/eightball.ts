import { slash } from '../../framework.ts'

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

export default slash({
  name: 'eightball',
  description: 'Ask the magic 8-ball a yes-or-no question',
  contexts: ['guild', 'botDm', 'privateChannel'],
  installations: ['guild', 'user'],
  options: {
    question: {
      description: 'Your yes-or-no question what else?',
      kind: 'string',
      maxLength: 200,
      required: true
    }
  },

  async execute(context) {
    const answer = responses[Math.floor(Math.random() * responses.length)]
    await context.reply(`🎱 ${answer}`)
  }
})
