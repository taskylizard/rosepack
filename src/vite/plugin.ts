import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createDebug } from 'obug'
import type { Plugin, ResolvedConfig } from 'vite'
import {
  discoverCommandModules,
  resolveCommandDirectory,
  resolvePrefixCommandDirectory
} from './discovery.ts'
import { DevelopmentRegistration } from './dev-registration.ts'
import { DevelopmentHostSupervisor } from './dev-host.ts'
import {
  resolvedManifestId,
  resolvedPrefixCommandsId,
  resolvedRegistrationCliId,
  resolvedSlashCommandsId,
  registrationCliId,
  resolveVirtualId
} from './ids.ts'
import { compileCommandManifest, emptyManifest } from './manifest.ts'
import { NativeAssetManager } from './native-assets.ts'
import { isInside, resolveFromRoot } from './paths.ts'
import type {
  ResolvedCommandDirectory,
  ResolvedPrefixCommandDirectory,
  RosepackBuildManifest,
  RosepackFrameworkOptions
} from './types.ts'
import {
  generateManifestModule,
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
  let prefix: ResolvedPrefixCommandDirectory | undefined
  let slashFiles: readonly string[] = []
  let prefixFiles: readonly string[] = []
  let manifest: RosepackBuildManifest = emptyManifest()
  let devRegistration: DevelopmentRegistration
  let devHost: DevelopmentHostSupervisor | undefined
  const nativeAssets = new NativeAssetManager()

  const refresh = async (): Promise<void> => {
    ;[slashFiles, prefixFiles] = await Promise.all([
      slash === undefined ? [] : discoverCommandModules(slash),
      prefix === undefined ? [] : discoverCommandModules(prefix)
    ])
    discoveryDebug(
      'found %d slash and %d prefix command modules',
      slashFiles.length,
      prefixFiles.length
    )
  }

  const compile = async (): Promise<void> => {
    manifest = await compileCommandManifest({ config, prefix, prefixFiles, slashFiles })
  }

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
      slash = resolveCommandDirectory(config.root, options.slashCommands, 'src/commands')
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
      for (const file of [...slashFiles, ...prefixFiles]) this.addWatchFile(file)
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
      const directories = [slash?.directory, prefix?.directory].filter(
        (directory): directory is string => directory !== undefined
      )
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
            resolvedPrefixCommandsId,
            resolvedManifestId
          ]) {
            const module = server.moduleGraph.getModuleById(id)
            if (module !== undefined) server.moduleGraph.invalidateModule(module)
          }
          hmrDebug('%s %s; invalidated generated command modules', event, file)
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
        return generateVirtualCommandModule(slashFiles, 'commands')
      if (id === resolvedPrefixCommandsId) {
        return generateVirtualCommandModule(prefixFiles, 'prefixCommands')
      }
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
