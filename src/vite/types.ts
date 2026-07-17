import type { CreateApplicationCommandOptions } from 'oceanic.js'

export interface RosepackCommandDirectoryOptions {
  /** Directory containing root command modules. Relative paths resolve from the Vite root. */
  readonly directory: string
  /** Files ignored after discovery. `index` modules are ignored by default. */
  readonly exclude?: readonly RegExp[]
}

export interface RosepackPrefixCommandDirectoryOptions extends RosepackCommandDirectoryOptions {
  /** Module exporting the configured prefix scope as `prefixCommands`. */
  readonly scope?: string
}

export interface RosepackDevelopmentOptions {
  /** Environment variable containing the Discord application ID. */
  readonly applicationIDEnv?: string
  /** Register slash commands into the development guild whenever metadata changes. */
  readonly guildRegistration?: boolean
  /** Environment variable containing the disposable development guild ID. */
  readonly guildIDEnv?: string
  /** Export called from the configured entry to start the supervised bot host. */
  readonly hostExport?: string
  /** Start and supervise the bot entry during `vp dev`. @default true */
  readonly host?: boolean
  /** Environment variable containing the test bot token. */
  readonly tokenEnv?: string
}

/** Options for rosepack framework mode. Library mode does not use this plugin. */
export interface RosepackFrameworkOptions {
  /** Development-only bot and guild behavior. */
  readonly development?: RosepackDevelopmentOptions
  /** Bot runtime entry bundled by `vp build`. */
  readonly entry?: string
  /** Message context-menu discovery, or `false` to disable it. */
  readonly messageContextMenus?: false | RosepackCommandDirectoryOptions
  /** Modal discovery, or `false` to disable it. */
  readonly modals?: false | RosepackCommandDirectoryOptions
  /** Prefix-command discovery, or `false` to disable it. */
  readonly prefixCommands?: false | RosepackPrefixCommandDirectoryOptions
  /** Emit the portable `rosepack.mjs` registration CLI. @default true */
  readonly registrationCli?: boolean
  /** Slash-command discovery, or `false` to disable it. */
  readonly slashCommands?: false | RosepackCommandDirectoryOptions
  /** User context-menu discovery, or `false` to disable it. */
  readonly userContextMenus?: false | RosepackCommandDirectoryOptions
}

export interface RosepackManifestCommand {
  readonly hash: string
  readonly key: `${number}:${string}`
  readonly payload: CreateApplicationCommandOptions
  readonly source: string
}

export interface RosepackBuildManifest {
  readonly messageContextMenus: readonly RosepackManifestCommand[]
  readonly modals: readonly { readonly customID: string; readonly source: string }[]
  readonly prefixCommands: readonly { readonly source: string }[]
  readonly schemaVersion: 2
  readonly slashCommands: readonly RosepackManifestCommand[]
  readonly userContextMenus: readonly RosepackManifestCommand[]
}

export interface ResolvedCommandDirectory {
  readonly directory: string
  readonly exclude: readonly RegExp[]
}

export interface ResolvedPrefixCommandDirectory extends ResolvedCommandDirectory {
  readonly scope?: string
}
