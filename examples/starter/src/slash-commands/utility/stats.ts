import { slashSub } from '../../framework.ts'
import pingCommand from '../fun/ping.ts'

export default slashSub({
  description: 'Show usage stats and invoke the ping command',

  async execute(context) {
    const views = context.app.stats.increment('stats.views')
    await context.defer({ ephemeral: true })
    await context.invoke(pingCommand, {})
    await context.followUp(`The stats command has been viewed ${views} time(s).`)
  }
})
