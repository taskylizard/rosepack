import type { Client } from 'oceanic.js'

export interface AppContext {
  readonly client: Client
  readonly startedAt: number
}
