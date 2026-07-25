import { createRosepack, defineModules, type RosepackModuleStateOptions } from '../../src/index.ts'

export interface TestApp {
  enabled: string[]
  owned: `${number}:${string}`[]
}

export const modules = defineModules({
  economy: { label: '🍣 Economy' },
  moderation: { description: 'Server moderation tools', label: '🔨 Moderation' }
})

type ModuleState = RosepackModuleStateOptions<TestApp, typeof modules>

export function createModuleState(
  overrides: Partial<Omit<ModuleState, 'catalog'>> = {}
): ModuleState {
  return {
    catalog: modules,
    async read({ app }) {
      return app.enabled
    },
    async readOwnedCommandKeys({ app }) {
      return app.owned
    },
    async mutate({ app, enabled, module }) {
      const before = app.enabled.includes(module)
      app.enabled = enabled
        ? [...new Set([...app.enabled, module])]
        : app.enabled.filter((id) => id !== module)
      return { changed: before !== enabled, modules: [...app.enabled] }
    },
    async writeOwnedCommandKeys({ app, keys }) {
      app.owned = [...keys]
    },
    ...overrides
  }
}

export function createModuleRosepack(overrides: Partial<Omit<ModuleState, 'catalog'>> = {}) {
  return createRosepack<TestApp>().withModules(createModuleState(overrides))
}
