import { expect, test, vi } from 'vite-plus/test'
import { runRosepackCli } from '../src/cli/index.ts'

test('exposes prepare through the extensible rosepack command catalog', async () => {
  const output: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((value) => {
    output.push(String(value))
  })

  try {
    await runRosepackCli(['--help'])
  } finally {
    log.mockRestore()
  }

  expect(output.join('\n')).toContain('prepare')
  expect(output.join('\n')).toContain('rosepack prepare --help')
})

test('reports the package version through Gunshi', async () => {
  const output: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((value) => {
    output.push(String(value))
  })

  try {
    await runRosepackCli(['--version'])
  } finally {
    log.mockRestore()
  }

  expect(output.join('\n')).toContain('0.1.0')
})
