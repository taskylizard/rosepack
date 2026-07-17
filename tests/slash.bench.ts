import { ApplicationCommandOptionTypes, CommandInteraction } from 'oceanic.js'
import { bench, describe } from 'vite-plus/test'
import {
  buildSlashCommandTree,
  createRosepack,
  slashCommandToDiscord,
  type SlashCommandValueOptionRecord
} from '../src/index.ts'

const rosepack = createRosepack<{}>()
const { slash, slashSub } = rosepack
const maximumOptions = Object.fromEntries(
  Array.from({ length: 25 }, (_, index) => [
    `value-${index}`,
    {
      description: `Value ${index}`,
      kind: index % 2 === 0 ? 'string' : 'integer',
      required: index < 12
    }
  ])
) as SlashCommandValueOptionRecord
const flatCommand = slash({
  description: 'Flat command',
  name: 'flat',
  options: maximumOptions,
  async execute() {}
})
const nestedCommand = slash({
  description: 'Nested command',
  name: 'nested',
  subcommands: {
    direct: slashSub({
      description: 'Direct leaf',
      options: {
        enabled: { description: 'Enabled', kind: 'boolean' },
        value: { description: 'Value', kind: 'string', required: true }
      },
      async execute() {}
    }),
    group: {
      description: 'Group',
      subcommands: {
        leaf: slashSub({
          description: 'Nested leaf',
          options: {
            count: { description: 'Count', kind: 'integer', required: true },
            mode: {
              choices: [
                { name: 'Fast', value: 'fast' },
                { name: 'Slow', value: 'slow' }
              ],
              description: 'Mode',
              kind: 'string',
              required: true
            }
          },
          async execute() {}
        })
      }
    }
  }
})
const registry = rosepack.createRegistry({ slashCommands: [flatCommand, nestedCommand] })
const flatInteraction = createInteraction('flat', [
  { name: 'value-0', type: ApplicationCommandOptionTypes.STRING, value: 'hello' },
  { name: 'value-1', type: ApplicationCommandOptionTypes.INTEGER, value: 42 },
  ...Array.from({ length: 10 }, (_, offset) => {
    const index = offset + 2
    return {
      name: `value-${index}`,
      type:
        index % 2 === 0
          ? ApplicationCommandOptionTypes.STRING
          : ApplicationCommandOptionTypes.INTEGER,
      value: index % 2 === 0 ? `value-${index}` : index
    }
  })
])
const nestedInteraction = createInteraction('nested', [
  {
    name: 'group',
    options: [
      {
        name: 'leaf',
        options: [
          { name: 'count', type: ApplicationCommandOptionTypes.INTEGER, value: 10 },
          { name: 'mode', type: ApplicationCommandOptionTypes.STRING, value: 'fast' }
        ],
        type: ApplicationCommandOptionTypes.SUB_COMMAND
      }
    ],
    type: ApplicationCommandOptionTypes.SUB_COMMAND_GROUP
  }
])

describe('slash registry construction and payloads', () => {
  bench('build a two-command registry', () => {
    buildSlashCommandTree([flatCommand, nestedCommand])
  })

  bench('build a maximum-option Discord payload', () => {
    slashCommandToDiscord(flatCommand)
  })
})

describe('slash registry lookup', () => {
  bench('get a root by name', () => {
    registry.get('nested')
  })

  bench('resolve a nested string path', () => {
    registry.resolve('/nested group leaf')
  })

  bench('resolve a nested array path', () => {
    registry.resolve(['nested', 'group', 'leaf'])
  })
})

describe('slash dispatch', () => {
  bench('dispatch a flat command with twelve options', async () => {
    await registry.dispatch({ app: {}, interaction: flatInteraction })
  })

  bench('dispatch a grouped subcommand', async () => {
    await registry.dispatch({ app: {}, interaction: nestedInteraction })
  })
})

function createInteraction(name: string, raw: unknown[]): CommandInteraction {
  // tasky: The inert interaction keeps benchmark time inside rosepack's routing and parsing work.
  return Object.assign(Object.create(CommandInteraction.prototype), {
    acknowledged: false,
    data: { name, options: { raw } },
    isChatInputCommand: () => true
  }) as CommandInteraction
}
