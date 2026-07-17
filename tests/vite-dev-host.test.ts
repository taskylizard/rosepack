import type { ViteDevServer } from 'vite'
import { expect, test, vi } from 'vite-plus/test'
import { DevelopmentHostSupervisor } from '../src/vite/dev-host.ts'

test('queues a restart until asynchronous host startup is ready', async () => {
  let markReady: (() => void) | undefined
  const ready = new Promise<void>((resolve) => {
    markReady = resolve
  })
  const stop = vi.fn()
  const start = vi
    .fn()
    .mockImplementationOnce(async () => {
      await ready
      return { stop }
    })
    .mockResolvedValueOnce({ stop })
  const server = {
    config: { mode: 'development', root: process.cwd() },
    ssrLoadModule: vi.fn(async () => ({ startRosepackApp: start }))
  } as unknown as ViteDevServer
  const supervisor = new DevelopmentHostSupervisor(server, '/src/index.ts')

  const starting = supervisor.start()
  const restarting = supervisor.restart('command changed')
  await Promise.resolve()

  expect(stop).not.toHaveBeenCalled()

  markReady?.()
  await starting
  await restarting

  expect(start).toHaveBeenCalledTimes(2)
  expect(stop).toHaveBeenCalledOnce()
})
