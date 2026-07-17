import type { Client } from 'oceanic.js'

export interface AppContext {
  client: Client
  notes: NotesService
  reminders: ReminderService
  stats: StatsService
}

export class NotesService {
  readonly #notes = new Map<string, string[]>()

  add(userID: string, content: string): number {
    const notes = this.#notes.get(userID) ?? []
    notes.push(content)
    this.#notes.set(userID, notes)
    return notes.length
  }

  list(userID: string): readonly string[] {
    return [...(this.#notes.get(userID) ?? [])]
  }
}

export interface Reminder {
  readonly content: string
  readonly durationSeconds: number
}

export class ReminderService {
  readonly #reminders = new Map<string, Reminder[]>()

  add(userID: string, durationSeconds: number, content: string): number {
    const reminders = this.#reminders.get(userID) ?? []
    reminders.push({ content, durationSeconds })
    this.#reminders.set(userID, reminders)
    return reminders.length
  }

  list(userID: string): readonly Reminder[] {
    return this.#reminders.get(userID)?.map((reminder) => ({ ...reminder })) ?? []
  }
}

export class StatsService {
  readonly #counters = new Map<string, number>()

  get(key: string): number {
    return this.#counters.get(key) ?? 0
  }

  increment(key: string): number {
    const value = this.get(key) + 1
    this.#counters.set(key, value)
    return value
  }
}
