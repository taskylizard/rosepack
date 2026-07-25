import {
  ApplicationCommandTypes,
  CommandInteraction,
  ComponentInteraction,
  ComponentTypes,
  ModalSubmitInteraction,
  type Client,
  type Message
} from 'oceanic.js'
import { vi } from 'vite-plus/test'

const fuzzAlphabet = [
  '\0',
  '\t',
  '\n',
  ' ',
  '"',
  "'",
  '\\',
  '-',
  '=',
  '[',
  ']',
  ':',
  '?',
  '_',
  'a',
  'Z',
  '0',
  'é',
  '\u00a0',
  '\ud800'
] as const

export function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b_79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

export function randomInteger(random: () => number, maximum: number): number {
  return Math.floor(random() * (maximum + 1))
}

export function randomString(
  random: () => number,
  length: number,
  alphabet: readonly string[] = fuzzAlphabet
): string {
  let result = ''
  for (let index = 0; index < length; index += 1) {
    result += alphabet[Math.floor(random() * alphabet.length)]
  }
  return result
}

export interface InteractionOverrides {
  readonly applicationID?: string
  readonly client?: unknown
  readonly createModal?: (data: unknown) => Promise<unknown>
  readonly guildID?: string | null
}

export function createInteraction(
  name: string,
  raw: readonly unknown[] = [],
  overrides: InteractionOverrides = {}
): CommandInteraction {
  return Object.assign(Object.create(CommandInteraction.prototype), {
    acknowledged: false,
    data: { name, options: { raw: [...raw] } },
    isChatInputCommand: () => true,
    isMessageCommand: () => false,
    isUserCommand: () => false,
    ...overrides
  }) as CommandInteraction
}

export function createContextMenuInteraction(
  name: string,
  kind: 'message' | 'user',
  target: object = { id: `${kind}-target` }
): CommandInteraction {
  return Object.assign(Object.create(CommandInteraction.prototype), {
    acknowledged: false,
    applicationID: 'application',
    client: {},
    data: { name, target },
    guildID: 'guild',
    isChatInputCommand: () => false,
    isMessageCommand: () => kind === 'message',
    isUserCommand: () => kind === 'user'
  }) as CommandInteraction
}

export function createModalInteraction(
  customID: string,
  values: Readonly<Record<string, string>>
): ModalSubmitInteraction {
  return Object.assign(Object.create(ModalSubmitInteraction.prototype), {
    acknowledged: false,
    data: {
      components: {
        getTextInput: (name: string) => values[name]
      },
      customID
    }
  }) as ModalSubmitInteraction
}

export type TestComponentInteraction = ComponentInteraction & {
  readonly mocks: {
    readonly deferUpdate: ReturnType<typeof vi.fn>
    readonly editOriginal: ReturnType<typeof vi.fn>
    readonly editParent: ReturnType<typeof vi.fn>
  }
}

export function createComponentInteraction(
  customID: string,
  componentType: ComponentTypes,
  values: readonly string[] = []
): TestComponentInteraction {
  let interaction!: TestComponentInteraction
  const deferUpdate = vi.fn(async () => {
    interaction.acknowledged = true
  })
  const editOriginal = vi.fn(async () => undefined)
  const editParent = vi.fn(async () => {
    interaction.acknowledged = true
  })

  interaction = Object.assign(Object.create(ComponentInteraction.prototype), {
    acknowledged: false,
    applicationID: 'application-id',
    client: {},
    data:
      componentType === ComponentTypes.BUTTON
        ? { componentType, customID }
        : { componentType, customID, values: { raw: [...values] } },
    defer: vi.fn(async () => {
      interaction.acknowledged = true
    }),
    deferUpdate,
    editOriginal,
    editParent,
    createFollowup: vi.fn(async () => undefined),
    createMessage: vi.fn(async () => {
      interaction.acknowledged = true
    }),
    deleteOriginal: vi.fn(async () => undefined),
    isSelectMenuComponentInteraction: () => componentType !== ComponentTypes.BUTTON,
    mocks: { deferUpdate, editOriginal, editParent }
  }) as TestComponentInteraction

  return interaction
}

export function createMessage(content: string, author: { bot: boolean } = { bot: false }): Message {
  return {
    author,
    channelID: 'channel',
    client: {
      getChannel: vi.fn(),
      guilds: new Map(),
      rest: {
        channels: { createMessage: vi.fn(async () => ({})) },
        users: {
          get: vi.fn(async () => {
            throw new Error('not found')
          })
        }
      },
      users: new Map()
    },
    content,
    guildID: null,
    mentions: { channels: [], everyone: false, members: [], roles: [], users: [] },
    webhookID: undefined
  } as unknown as Message
}

export function createRoutes(commands: readonly Record<string, unknown>[] = []) {
  return {
    createGlobalCommand: vi.fn(async () => undefined),
    createGuildCommand: vi.fn(async () => undefined),
    deleteGlobalCommand: vi.fn(async () => undefined),
    deleteGuildCommand: vi.fn(async () => undefined),
    editGlobalCommand: vi.fn(async () => undefined),
    editGuildCommand: vi.fn(async () => undefined),
    getGlobalCommands: vi.fn(async () => [...commands]),
    getGuildCommands: vi.fn(async () => [...commands])
  }
}

export function createClient(routes: ReturnType<typeof createRoutes>): Client {
  return { rest: { applications: routes } } as unknown as Client
}

export function createCommandPayload(name: string) {
  return {
    description: name,
    name,
    type: ApplicationCommandTypes.CHAT_INPUT
  } as const
}
