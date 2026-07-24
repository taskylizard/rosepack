import type { Message, User } from 'oceanic.js'
import type { ContextMenuCommandContext } from './interaction-context.ts'
import type { SlashCommandContextName, SlashCommandInstallation } from './metadata.ts'
import type { RosepackModuleCatalog, RosepackModuleValue } from './modules.ts'

export type ContextMenuKind = 'message' | 'user'

export interface ContextMenuDefinitionBase<
  TApp,
  TKind extends ContextMenuKind,
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
> {
  readonly kind: TKind
  beforeExecute?(context: ContextMenuCommandContext<TApp, TKind, TCatalog>): void | Promise<void>
  contexts?: readonly SlashCommandContextName[]
  execute(context: ContextMenuCommandContext<TApp, TKind, TCatalog>): Promise<void>
  installations?: readonly SlashCommandInstallation[]
  /** Optional guild feature controlling this command's registration and execution. */
  module?: RosepackModuleValue<TCatalog>
  name: string
  onError?(
    context: ContextMenuCommandContext<TApp, TKind, TCatalog>,
    error: unknown
  ): void | Promise<void>
}

export type UserContextMenuDefinition<
  TApp = unknown,
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
> = ContextMenuDefinitionBase<TApp, 'user', TCatalog>
export type MessageContextMenuDefinition<
  TApp = unknown,
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
> = ContextMenuDefinitionBase<TApp, 'message', TCatalog>
export type ContextMenuDefinition<
  TApp = unknown,
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
> = UserContextMenuDefinition<TApp, TCatalog> | MessageContextMenuDefinition<TApp, TCatalog>

export type ContextMenuTarget<TKind extends ContextMenuKind> = TKind extends 'user' ? User : Message

export interface UserMenuBuilder<
  TApp,
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
> {
  (
    definition: Omit<UserContextMenuDefinition<TApp, TCatalog>, 'kind'>
  ): UserContextMenuDefinition<TApp, TCatalog>
}

export interface MessageMenuBuilder<
  TApp,
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
> {
  (
    definition: Omit<MessageContextMenuDefinition<TApp, TCatalog>, 'kind'>
  ): MessageContextMenuDefinition<TApp, TCatalog>
}

export function createUserContextMenuDefinition<
  TApp,
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
>(
  definition: Omit<UserContextMenuDefinition<TApp, TCatalog>, 'kind'>
): UserContextMenuDefinition<TApp, TCatalog> {
  return { ...definition, kind: 'user' }
}

export function createMessageContextMenuDefinition<
  TApp,
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
>(
  definition: Omit<MessageContextMenuDefinition<TApp, TCatalog>, 'kind'>
): MessageContextMenuDefinition<TApp, TCatalog> {
  return { ...definition, kind: 'message' }
}
