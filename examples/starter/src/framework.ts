import { createRosepack } from 'rosepack'
import type { AppContext } from './context.ts'

export const rosepack = createRosepack<AppContext>({
  onUnknownCommand({ interaction }) {
    console.warn(`Ignoring unknown command: ${interaction.data.name}`)
  }
})

export const { messageMenu, modal, slash, slashSub, userMenu } = rosepack

const Duration = rosepack.prefixParser({
  consumption: 'token',
  parse({ fail, value }) {
    const match = /^(\d+)([smhd])$/u.exec(value)
    if (match === null) {
      return fail(`Expected a duration such as 30s, 5m, 2h, or 1d; received "${value}".`)
    }
    const units = { d: 86_400, h: 3_600, m: 60, s: 1 } as const
    return Number(match[1]) * units[match[2] as keyof typeof units]
  }
})

export const prefixCommands = rosepack.createPrefixCommands({ parsers: { Duration } })
export const { prefix } = prefixCommands
