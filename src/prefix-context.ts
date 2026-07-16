import type { Client, CreateMessageOptions, Message } from 'oceanic.js'
import type {
  PrefixCommandDefinitionBase,
  PrefixCommandTreeNode,
  PrefixExecutableCommandDefinition
} from './prefix-commands.ts'
import { invokePrefixRegistryCommand, prefixInvocationTrail } from './prefix-internal.ts'
import type { PrefixCommandRegistry } from './prefix-registry.ts'

const safeAllowedMentions = {
  everyone: false,
  repliedUser: false,
  roles: false,
  users: false
} as const

/** The current prefix-command invocation and its inferred positional and flag values. */
export class PrefixCommandContext<TApp, TOptions extends object = {}, TFlags extends object = {}> {
  readonly app: TApp
  readonly command: PrefixCommandTreeNode<TApp>
  readonly flags: TFlags
  readonly message: Message
  readonly node: PrefixCommandTreeNode<TApp>
  readonly options: TOptions
  readonly path: readonly string[]
  readonly prefix: string
  readonly rawArguments: string
  readonly registry: PrefixCommandRegistry<TApp>
  readonly [prefixInvocationTrail]: readonly PrefixCommandDefinitionBase<TApp>[]

  constructor(config: {
    app: TApp
    command: PrefixCommandTreeNode<TApp>
    flags: TFlags
    invocationTrail?: readonly PrefixCommandDefinitionBase<TApp>[]
    message: Message
    node: PrefixCommandTreeNode<TApp>
    options: TOptions
    prefix: string
    rawArguments: string
    registry: PrefixCommandRegistry<TApp>
  }) {
    this.app = config.app
    this.command = config.command
    this.flags = config.flags
    this.message = config.message
    this.node = config.node
    this.options = config.options
    this.path = config.node.path
    this.prefix = config.prefix
    this.rawArguments = config.rawArguments
    this.registry = config.registry
    this[prefixInvocationTrail] = config.invocationTrail ?? []
  }

  get client(): Client {
    return this.message.client
  }

  /** Sends a safe-by-default message in the source channel. */
  reply(content: CreateMessageOptions | string): Promise<Message> {
    const payload =
      typeof content === 'string'
        ? { allowedMentions: safeAllowedMentions, content }
        : { ...content, allowedMentions: content.allowedMentions ?? safeAllowedMentions }
    return this.message.client.rest.channels.createMessage(this.message.channelID, payload)
  }

  /** Invokes another registered executable prefix command without reparsing text. */
  async invoke<TTargetOptions extends object, TTargetFlags extends object>(
    target: PrefixExecutableCommandDefinition<TApp, TTargetOptions, TTargetFlags>,
    values: {
      flags: TTargetFlags
      options: TTargetOptions
    }
  ): Promise<void>
  async invoke(
    target: PrefixCommandTreeNode<TApp>,
    values: {
      flags?: Readonly<Record<string, unknown>>
      options?: Readonly<Record<string, unknown>>
    }
  ): Promise<void>
  async invoke(
    target: PrefixExecutableCommandDefinition<TApp, object, object> | PrefixCommandTreeNode<TApp>,
    values: {
      flags?: Readonly<Record<string, unknown>>
      options?: Readonly<Record<string, unknown>>
    }
  ): Promise<void> {
    await this.registry[invokePrefixRegistryCommand](this, target, {
      flags: values.flags ?? {},
      options: values.options ?? {}
    })
  }
}
