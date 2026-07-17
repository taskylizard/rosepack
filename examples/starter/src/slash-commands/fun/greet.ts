import { slash } from '../../framework.ts'

export default slash({
  name: 'greet',
  description: 'Send someone a greeting',
  contexts: ['guild', 'botDm', 'privateChannel'],
  installations: ['guild', 'user'],
  options: {
    style: {
      choices: [
        { name: 'Brief', value: 'brief' },
        { name: 'Excited', value: 'excited' },
        { name: 'Warm', value: 'warm' }
      ],
      description: 'How enthusiastic the greeting should be',
      kind: 'string'
    },
    user: {
      description: 'Discord user ID to greet (defaults to you)',
      kind: 'string'
    }
  },

  async execute(context) {
    const userID = context.options.user ?? context.interaction.user.id
    const greetings = {
      brief: `Hi, <@${userID}>.`,
      excited: `HEY <@${userID}>! Great to see you! 🎉`,
      warm: `Welcome, <@${userID}> — we are glad you are here!`
    }
    await context.reply(greetings[context.options.style ?? 'warm'])
  }
})
