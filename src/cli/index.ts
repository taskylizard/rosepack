import { cli, define } from 'gunshi'
import packageJson from '../../package.json' with { type: 'json' }
import { prepareCommand } from './prepare.ts'

const entry = define({
  name: 'rosepack',
  description: 'Develop, validate, and operate rosepack applications.'
})

export function runRosepackCli(arguments_: readonly string[]): Promise<string | undefined> {
  return cli([...arguments_], entry, {
    description: entry.description,
    name: entry.name,
    strict: true,
    subCommands: {
      prepare: prepareCommand
    },
    version: packageJson.version
  })
}
