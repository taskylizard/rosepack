import type { Message, User } from 'oceanic.js'
import type { ContextMenuCommandContext } from './interaction-context.ts'
import type { SlashCommandContextName, SlashCommandInstallation } from './metadata.ts'

export type ContextMenuKind = 'message' | 'user'

export interface ContextMenuDefinitionBase<TApp, TKind extends ContextMenuKind> {
  readonly kind: TKind
  beforeExecute?(context: ContextMenuCommandContext<TApp, TKind>): void | Promise<void>
  contexts?: readonly SlashCommandContextName[]
  execute(context: ContextMenuCommandContext<TApp, TKind>): Promise<void>
  installations?: readonly SlashCommandInstallation[]
  name: string
  onError?(context: ContextMenuCommandContext<TApp, TKind>, error: unknown): void | Promise<void>
}

export type UserContextMenuDefinition<TApp = unknown> = ContextMenuDefinitionBase<TApp, 'user'>
export type MessageContextMenuDefinition<TApp = unknown> = ContextMenuDefinitionBase<
  TApp,
  'message'
>
export type ContextMenuDefinition<TApp = unknown> =
  | UserContextMenuDefinition<TApp>
  | MessageContextMenuDefinition<TApp>

export type ContextMenuTarget<TKind extends ContextMenuKind> = TKind extends 'user' ? User : Message

export interface UserMenuBuilder<TApp> {
  (definition: Omit<UserContextMenuDefinition<TApp>, 'kind'>): UserContextMenuDefinition<TApp>
}

export interface MessageMenuBuilder<TApp> {
  (definition: Omit<MessageContextMenuDefinition<TApp>, 'kind'>): MessageContextMenuDefinition<TApp>
}

export function createUserContextMenuDefinition<TApp>(
  definition: Omit<UserContextMenuDefinition<TApp>, 'kind'>
): UserContextMenuDefinition<TApp> {
  return { ...definition, kind: 'user' }
}

export function createMessageContextMenuDefinition<TApp>(
  definition: Omit<MessageContextMenuDefinition<TApp>, 'kind'>
): MessageContextMenuDefinition<TApp> {
  return { ...definition, kind: 'message' }
}
