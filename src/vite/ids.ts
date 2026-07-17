export const slashCommandsId = 'virtual:rosepack/slash-commands'
export const userContextMenusId = 'virtual:rosepack/user-context-menus'
export const messageContextMenusId = 'virtual:rosepack/message-context-menus'
export const modalsId = 'virtual:rosepack/modals'
export const prefixCommandsId = 'virtual:rosepack/prefix-commands'
export const manifestId = 'virtual:rosepack/manifest'
export const registrationCliId = 'virtual:rosepack/registration-cli'

export const resolvedSlashCommandsId = `\0${slashCommandsId}`
export const resolvedUserContextMenusId = `\0${userContextMenusId}`
export const resolvedMessageContextMenusId = `\0${messageContextMenusId}`
export const resolvedModalsId = `\0${modalsId}`
export const resolvedPrefixCommandsId = `\0${prefixCommandsId}`
export const resolvedManifestId = `\0${manifestId}`
export const resolvedRegistrationCliId = `\0${registrationCliId}`

export function resolveVirtualId(id: string): string | undefined {
  if (id === slashCommandsId) return resolvedSlashCommandsId
  if (id === userContextMenusId) return resolvedUserContextMenusId
  if (id === messageContextMenusId) return resolvedMessageContextMenusId
  if (id === modalsId) return resolvedModalsId
  if (id === prefixCommandsId) return resolvedPrefixCommandsId
  if (id === manifestId) return resolvedManifestId
  if (id === registrationCliId) return resolvedRegistrationCliId
  return undefined
}
