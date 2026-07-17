declare module 'virtual:rosepack/commands' {
  const commands: readonly import('rosepack').SlashRootCommandDefinitionBase<any>[]
  export { commands }
  export default commands
}

declare module 'virtual:rosepack/prefix-commands' {
  const prefixCommands: readonly import('rosepack').PrefixCommandDefinitionBase<any>[]
  export { prefixCommands }
  export default prefixCommands
}
