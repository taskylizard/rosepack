import { MessageFlags } from 'oceanic.js'
import { createRosepack } from 'rosepack'
import type { AppContext } from './context.ts'

export const rosepack = createRosepack<AppContext>({
  async onUnknownCommand({ interaction }) {
    await interaction.createMessage({
      content: `Unknown command: ${interaction.data.name}`,
      flags: MessageFlags.EPHEMERAL
    })
  }
})

export const { slashFile: slash } = rosepack
