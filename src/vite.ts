export { rosepack } from './vite/plugin.ts'
export { discoverCommandModules } from './vite/discovery.ts'
export { generateVirtualCommandModule } from './vite/virtual-modules.ts'
export { generateDeclarations, generateRosepackTypes } from './vite/typegen.ts'
export type {
  RosepackBuildManifest,
  RosepackCommandDirectoryOptions,
  RosepackFrameworkOptions,
  RosepackManifestCommand,
  RosepackPrefixCommandDirectoryOptions
} from './vite/types.ts'
