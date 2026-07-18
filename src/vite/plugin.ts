import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createDebug } from 'obug'
import type { Plugin, ResolvedConfig } from 'vite'
import { DevelopmentHostSupervisor } from './dev-host.ts'
import { DevelopmentRegistration } from './dev-registration.ts'
import {
  discoverCommandModules,
  discoverFileCommandModules,
  resolveCommandDirectory,
  resolvePrefixCommandDirectory
} from './discovery.ts'
import {
  registrationCliId,
  resolvedManifestId,
  resolvedMessageContextMenusId,
  resolvedModalsId,
  resolvedPrefixCommandsId,
  resolvedRegistrationCliId,
  resolvedSlashCommandsId,
  resolvedUserContextMenusId,
  resolveVirtualId
} from './ids.ts'
import { compileCommandManifest, emptyManifest } from './manifest.ts'
import { NativeAssetManager } from './native-assets.ts'
import { isInside, resolveFromRoot } from './paths.ts'
import { generateRosepackTypes } from './typegen.ts'
import type {
  ResolvedCommandDirectory,
  ResolvedPrefixCommandDirectory,
  DiscoveredCommandFile,
  RosepackBuildManifest,
  RosepackFrameworkOptions
} from './types.ts'
import {
  generateManifestModule,
  generateFileCommandModule,
  generateRegistrationCliModule,
  generateVirtualCommandModule
} from './virtual-modules.ts'

const debug = createDebug('rosepack:vite')
const discoveryDebug = debug.extend('discovery')
const hmrDebug = debug.extend('hmr')

/** Enables rosepack framework mode. Library mode continues to use the runtime APIs directly. */
export function rosepack(options: RosepackFrameworkOptions = {}): Plugin {
  let config: ResolvedConfig
  let slash: ResolvedCommandDirectory | undefined
  let userMenus: ResolvedCommandDirectory | undefined
  let messageMenus: ResolvedCommandDirectory | undefined
  let modals: ResolvedCommandDirectory | undefined
  let prefix: ResolvedPrefixCommandDirectory | undefined
  let slashFiles: readonly string[] = []
  let slashRoutes: readonly DiscoveredCommandFile[] = []
  let userMenuFiles: readonly string[] = []
  let messageMenuFiles: readonly string[] = []
  let modalFiles: readonly string[] = []
  let prefixFiles: readonly string[] = []
  let prefixRoutes: readonly DiscoveredCommandFile[] = []
  let manifest: RosepackBuildManifest = emptyManifest()
  let devRegistration: DevelopmentRegistration
  let devHost: DevelopmentHostSupervisor | undefined
  const nativeAssets = new NativeAssetManager()

  const refresh = async (): Promise<void> => {
    ;[slashRoutes, userMenuFiles, messageMenuFiles, modalFiles, prefixRoutes] = await Promise.all([
      discoverFileRoutes(slash, 'slash'),
      discover(userMenus),
      discover(messageMenus),
      discover(modals),
      discoverFileRoutes(prefix, 'prefix')
    ])
    slashFiles = slashRoutes.map((route) => route.file)
    prefixFiles = prefixRoutes.map((route) => route.file)
    discoveryDebug(
      'found %d slash, %d user menu, %d message menu, %d modal, and %d prefix modules',
      slashFiles.length,
      userMenuFiles.length,
      messageMenuFiles.length,
      modalFiles.length,
      prefixFiles.length
    )
  }

  const compile = async (): Promise<void> => {
    manifest = await compileCommandManifest({
      config,
      messageContextMenuFiles: messageMenuFiles,
      modalFiles,
      prefix,
      prefixFiles,
      prefixRoutes,
      slashFiles,
      slashRoutes,
      userContextMenuFiles: userMenuFiles
    })
    await generateRosepackTypes({
      manifest,
      messageContextMenuFiles: messageMenuFiles,
      modalFiles,
      prefixFiles,
      prefixRoutes,
      root: config.root,
      slashFiles,
      slashRoutes,
      userContextMenuFiles: userMenuFiles
    })
  }

  const prepare = async (): Promise<void> => {
    await refresh()
    await compile()
  }

  const allFiles = (): readonly string[] => [
    ...slashFiles,
    ...userMenuFiles,
    ...messageMenuFiles,
    ...modalFiles,
    ...prefixFiles
  ]

  const reconcileDevelopmentCommands = async (reason: string): Promise<void> => {
    try {
      await devRegistration.reconcile(manifest, reason)
    } catch (error) {
      const errorCode =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
      const code =
        errorCode === undefined
          ? ''
          : typeof errorCode === 'number'
            ? ` (Discord code ${errorCode})`
            : typeof errorCode === 'string'
              ? ` (${errorCode})`
              : ''
      hmrDebug('development registration failed%s: %s', code, error)
      config.logger.warn(`[rosepack] Development guild registration failed${code}.`)
    }
  }

  return {
    api: { prepare },
    name: 'rosepack',

    config(userConfig, environment) {
      if (environment.command !== 'build') return undefined
      const root = resolve(userConfig.root ?? process.cwd())
      const input: Record<string, string> = {
        index: resolveFromRoot(root, options.entry ?? 'src/index.ts')
      }
      if (options.registrationCli !== false) input.rosepack = registrationCliId
      return {
        build: {
          rolldownOptions: {
            input,
            output: {
              chunkFileNames: '[name]-[hash].mjs',
              entryFileNames: '[name].mjs'
            }
          },
          ssr: true
        },
        ssr: { noExternal: true }
      }
    },

    configResolved(resolvedConfig) {
      config = resolvedConfig
      slash = resolveCommandDirectory(config.root, options.slashCommands, 'src/slash-commands')
      userMenus = resolveCommandDirectory(
        config.root,
        options.userContextMenus,
        'src/user-context-menus'
      )
      messageMenus = resolveCommandDirectory(
        config.root,
        options.messageContextMenus,
        'src/message-context-menus'
      )
      modals = resolveCommandDirectory(config.root, options.modals, 'src/modals')
      prefix = resolvePrefixCommandDirectory(
        config.root,
        options.prefixCommands,
        'src/prefix-commands'
      )
      devRegistration = new DevelopmentRegistration(config, options.development)
      debug('framework mode enabled for %s', config.root)
    },

    async buildStart() {
      await refresh()
      for (const file of allFiles()) this.addWatchFile(file)
      await compile()
      if (config.command === 'build') {
        this.emitFile({
          fileName: 'commands.manifest.json',
          source: `${JSON.stringify(manifest, undefined, 2)}\n`,
          type: 'asset'
        })
      }
    },

    async configureServer(server) {
      await refresh()
      await compile()
      await reconcileDevelopmentCommands('server start')
      const directories = [
        slash?.directory,
        userMenus?.directory,
        messageMenus?.directory,
        modals?.directory,
        prefix?.directory
      ].filter((directory): directory is string => directory !== undefined)
      const applicationDirectory = resolve(config.root, 'src')
      server.watcher.add(directories)

      if (config.mode !== 'test' && options.development?.host !== false) {
        devHost = new DevelopmentHostSupervisor(
          server,
          resolveFromRoot(config.root, options.entry ?? 'src/index.ts'),
          options.development
        )
        server.httpServer?.once('close', () => void devHost?.stop())
      }

      const update = async (file: string, event: string): Promise<void> => {
        if (!directories.some((directory) => isInside(directory, file))) return
        try {
          await refresh()
          await compile()
          for (const id of [
            resolvedSlashCommandsId,
            resolvedUserContextMenusId,
            resolvedMessageContextMenusId,
            resolvedModalsId,
            resolvedPrefixCommandsId,
            resolvedManifestId
          ]) {
            const module = server.moduleGraph.getModuleById(id)
            if (module !== undefined) server.moduleGraph.invalidateModule(module)
          }
          hmrDebug('%s %s; invalidated generated interaction modules', event, file)
          await reconcileDevelopmentCommands(`${event}: ${file}`)
          await devHost?.restart(`${event}: ${file}`)
        } catch (error) {
          hmrDebug('%s %s failed: %O', event, file, error)
          server.config.logger.error(
            `[rosepack] ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }

      server.watcher.on('add', (file) => void update(file, 'added'))
      server.watcher.on('change', (file) => void update(file, 'changed'))
      server.watcher.on('unlink', (file) => void update(file, 'removed'))
      server.watcher.on('change', (file) => {
        if (
          devHost !== undefined &&
          isInside(applicationDirectory, file) &&
          !directories.some((directory) => isInside(directory, file))
        ) {
          void devHost.restart(`changed: ${file}`).catch((error: unknown) => {
            server.config.logger.error(
              `[rosepack] Development host restart failed: ${error instanceof Error ? error.message : String(error)}`
            )
          })
        }
      })

      return async () => {
        try {
          await devHost?.start()
        } catch (error) {
          server.config.logger.error(
            `[rosepack] Development host failed: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
    },

    resolveId: resolveVirtualId,

    async load(id) {
      if (id === resolvedSlashCommandsId)
        return generateFileCommandModule(slashRoutes, 'slashCommands')
      if (id === resolvedUserContextMenusId)
        return generateVirtualCommandModule(userMenuFiles, 'userContextMenus')
      if (id === resolvedMessageContextMenusId)
        return generateVirtualCommandModule(messageMenuFiles, 'messageContextMenus')
      if (id === resolvedModalsId) return generateVirtualCommandModule(modalFiles, 'modals')
      if (id === resolvedPrefixCommandsId)
        return generateFileCommandModule(prefixRoutes, 'prefixCommands')
      if (id === resolvedManifestId) return generateManifestModule(manifest)
      if (id === resolvedRegistrationCliId) return generateRegistrationCliModule()
      if (id.endsWith('.node')) return nativeAssets.load(this, config, id)
      return undefined
    },

    async writeBundle() {
      const outDirectory = resolve(config.root, config.build.outDir)
      await mkdir(outDirectory, { recursive: true })
      await writeFile(
        resolve(outDirectory, 'commands.manifest.json'),
        `${JSON.stringify(manifest, undefined, 2)}\n`
      )
      await nativeAssets.copyFallbacks(outDirectory)
    }
  }
}

function discover(directory: ResolvedCommandDirectory | undefined): Promise<readonly string[]> {
  return directory === undefined ? Promise.resolve([]) : discoverCommandModules(directory)
}

function discoverFileRoutes(
  directory: ResolvedCommandDirectory | undefined,
  kind: 'prefix' | 'slash'
): Promise<readonly DiscoveredCommandFile[]> {
  return directory === undefined ? Promise.resolve([]) : discoverFileCommandModules(directory, kind)
}
