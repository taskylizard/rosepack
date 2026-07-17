import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import type { ResolvedConfig } from 'vite'

interface NativeAssetPluginContext {
  emitFile(asset: { fileName: string; source: Uint8Array; type: 'asset' }): string
}

export class NativeAssetManager {
  readonly #assets = new Map<string, string>()

  async load(
    context: NativeAssetPluginContext,
    config: ResolvedConfig,
    id: string
  ): Promise<string> {
    if (config.command !== 'build') {
      return [
        `import { createRequire } from 'node:module'`,
        `const binding = createRequire(import.meta.url)(${JSON.stringify(id)})`,
        `export default binding`
      ].join('\n')
    }
    const source = await readFile(id)
    const digest = createHash('sha256').update(source).digest('hex').slice(0, 12)
    const fileName = `native/${digest}-${basename(id)}`
    this.#assets.set(fileName, id)
    const reference = context.emitFile({ fileName, source, type: 'asset' })
    return [
      `import { createRequire } from 'node:module'`,
      `import { fileURLToPath } from 'node:url'`,
      `const binding = createRequire(import.meta.url)(fileURLToPath(import.meta.ROLLUP_FILE_URL_${reference}))`,
      `export default binding`
    ].join('\n')
  }

  async copyFallbacks(outDirectory: string): Promise<void> {
    for (const [fileName, source] of this.#assets) {
      const destination = resolve(outDirectory, fileName)
      await mkdir(dirname(destination), { recursive: true })
      await copyFile(source, destination)
    }
  }
}
