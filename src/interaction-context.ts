import { ApplicationCommandTypes, MessageFlags } from 'oceanic.js'
import type {
  Client,
  CommandInteraction,
  EditInteractionContent,
  InteractionContent,
  Message,
  ModalSubmitInteraction,
  User
} from 'oceanic.js'
import type { ContextMenuDefinition, ContextMenuKind } from './context-menus.ts'
import { ModalRouteError } from './errors.ts'
import type {
  AnyModalDefinition,
  ModalBuildOptions,
  ModalDefinition,
  ModalFieldRecord,
  ModalFieldValues,
  ModalRouteParams,
  RosepackGeneratedModalCatalog
} from './modals.ts'
import { normalizeResponseContent } from './responses.ts'
import type { InteractionRegistry } from './registry.ts'
import type { RosepackModuleCatalog, RosepackModuleContext } from './modules.ts'

type GeneratedModalID = Extract<keyof RosepackGeneratedModalCatalog, string>

export class ContextMenuCommandContext<
  TApp,
  TKind extends ContextMenuKind,
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
> {
  readonly app: TApp
  readonly command: ContextMenuDefinition<TApp, TCatalog>
  readonly interaction: CommandInteraction<
    never,
    TKind extends 'user' ? ApplicationCommandTypes.USER : ApplicationCommandTypes.MESSAGE
  >
  readonly modules: RosepackModuleContext<TApp, TCatalog>
  readonly registry: InteractionRegistry<TApp, TCatalog>
  readonly target: TKind extends 'user' ? User : Message

  constructor(config: {
    app: TApp
    command: ContextMenuDefinition<TApp, TCatalog>
    interaction: ContextMenuCommandContext<TApp, TKind, TCatalog>['interaction']
    registry: InteractionRegistry<TApp, TCatalog>
    target: ContextMenuCommandContext<TApp, TKind, TCatalog>['target']
  }) {
    this.app = config.app
    this.command = config.command
    this.interaction = config.interaction
    this.modules = config.registry.modules.context({
      app: config.app,
      applicationID: config.interaction.applicationID,
      client: config.interaction.client,
      guildID: config.interaction.guildID
    })
    this.registry = config.registry
    this.target = config.target
  }

  get client(): Client {
    return this.interaction.client
  }

  get acknowledged(): boolean {
    return this.interaction.acknowledged
  }

  async defer(options: number | { ephemeral?: boolean } = {}): Promise<void> {
    if (this.acknowledged) return
    const flags =
      typeof options === 'number'
        ? options
        : options.ephemeral === true
          ? MessageFlags.EPHEMERAL
          : undefined
    await this.interaction.defer(flags)
  }

  async reply(content: EditInteractionContent | string): Promise<void> {
    await this.editResponse(content)
  }

  async editResponse(content: EditInteractionContent | string): Promise<void> {
    const payload = normalizeResponseContent(content)
    if (this.acknowledged) await this.interaction.editOriginal(payload)
    else await this.interaction.createMessage(payload as InteractionContent)
  }

  async followUp(content: InteractionContent | string): Promise<void> {
    await this.interaction.createFollowup(normalizeResponseContent(content))
  }

  async deleteResponse(): Promise<void> {
    await this.interaction.deleteOriginal()
  }

  async showModal<TModal extends AnyModalDefinition<TApp>>(
    modal: TModal,
    options: TModal extends ModalDefinition<TApp, infer TRoute, infer TFields>
      ? ModalBuildOptions<TRoute, TFields>
      : never
  ): Promise<void>
  async showModal<const TID extends GeneratedModalID>(
    modal: TID,
    options: RosepackGeneratedModalCatalog[TID] extends ModalDefinition<
      TApp,
      infer TRoute,
      infer TFields
    >
      ? ModalBuildOptions<TRoute, TFields>
      : never
  ): Promise<void>
  async showModal(
    modal: AnyModalDefinition<TApp> | string,
    options: ModalBuildOptions<string, ModalFieldRecord>
  ): Promise<void> {
    if (this.acknowledged)
      throw new Error('Cannot show a modal after acknowledging an interaction.')
    const route = typeof modal === 'string' ? modal : modal.customID
    const definition = typeof modal === 'string' ? this.registry.getModal(modal) : modal
    if (definition === undefined)
      throw new ModalRouteError('unknown-route', `Unknown modal route "${route}".`)
    await this.interaction.createModal(definition.build(options as never))
  }
}

export class ModalContext<
  TApp,
  TRoute extends string,
  TFields extends ModalFieldRecord,
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
> {
  readonly app: TApp
  readonly interaction: ModalSubmitInteraction
  readonly modal: ModalDefinition<TApp, TRoute, TFields>
  readonly params: ModalRouteParams<TRoute>
  readonly registry: InteractionRegistry<TApp, TCatalog>
  readonly values: ModalFieldValues<TFields>

  constructor(config: {
    app: TApp
    interaction: ModalSubmitInteraction
    modal: ModalDefinition<TApp, TRoute, TFields>
    params: ModalRouteParams<TRoute>
    registry: InteractionRegistry<TApp, TCatalog>
    values: ModalFieldValues<TFields>
  }) {
    this.app = config.app
    this.interaction = config.interaction
    this.modal = config.modal
    this.params = config.params
    this.registry = config.registry
    this.values = config.values
  }

  get client(): Client {
    return this.interaction.client
  }

  get acknowledged(): boolean {
    return this.interaction.acknowledged
  }

  async defer(options: number | { ephemeral?: boolean } = {}): Promise<void> {
    if (this.acknowledged) return
    const flags =
      typeof options === 'number'
        ? options
        : options.ephemeral === true
          ? MessageFlags.EPHEMERAL
          : undefined
    await this.interaction.defer(flags)
  }

  async deferUpdate(flags?: number): Promise<void> {
    if (!this.acknowledged) await this.interaction.deferUpdate(flags)
  }

  async editParent(content: InteractionContent | string): Promise<void> {
    await this.interaction.editParent(normalizeResponseContent(content))
  }

  async reply(content: EditInteractionContent | string): Promise<void> {
    const payload = normalizeResponseContent(content)
    if (this.acknowledged) await this.interaction.editOriginal(payload)
    else await this.interaction.createMessage(payload as InteractionContent)
  }

  async editResponse(content: EditInteractionContent | string): Promise<void> {
    await this.reply(content)
  }

  async followUp(content: InteractionContent | string): Promise<void> {
    await this.interaction.createFollowup(normalizeResponseContent(content))
  }

  async deleteResponse(): Promise<void> {
    await this.interaction.deleteOriginal()
  }
}
