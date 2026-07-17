import { define } from 'gunshi'
import { resolveConfig } from 'vite'

interface RosepackPluginApi {
  readonly prepare: () => Promise<void>
}

export const prepareCommand = define({
  name: 'prepare',
  description: 'Discover framework definitions and generate the .rosepack type catalog.',

  async run(context) {
    const root = await prepareRosepackProject(context.env.cwd)
    console.info(`rosepack prepared ${root}/.rosepack`)
  }
})

export async function prepareRosepackProject(cwd = process.cwd()): Promise<string> {
  const config = await resolveConfig({ root: cwd }, 'build')
  const plugin = config.plugins.find(
    (candidate): candidate is typeof candidate & { api: RosepackPluginApi } =>
      candidate.name === 'rosepack' &&
      typeof candidate.api === 'object' &&
      candidate.api !== null &&
      'prepare' in candidate.api
  )
  if (plugin === undefined) {
    throw new Error('The current Vite config does not include the rosepack plugin.')
  }

  await plugin.api.prepare()
  return config.root
}
