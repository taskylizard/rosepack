export const slashCommandsId = 'virtual:rosepack/commands'
export const prefixCommandsId = 'virtual:rosepack/prefix-commands'
export const manifestId = 'virtual:rosepack/manifest'
export const registrationCliId = 'virtual:rosepack/registration-cli'

export const resolvedSlashCommandsId = `\0${slashCommandsId}`
export const resolvedPrefixCommandsId = `\0${prefixCommandsId}`
export const resolvedManifestId = `\0${manifestId}`
export const resolvedRegistrationCliId = `\0${registrationCliId}`

export function resolveVirtualId(id: string): string | undefined {
  if (id === slashCommandsId) return resolvedSlashCommandsId
  if (id === prefixCommandsId) return resolvedPrefixCommandsId
  if (id === manifestId) return resolvedManifestId
  if (id === registrationCliId) return resolvedRegistrationCliId
  return undefined
}
