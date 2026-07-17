import { expect, test } from 'vite-plus/test'
import { NotesService, ReminderService, StatsService } from '../src/context.ts'

test('stores independent note snapshots for each user', () => {
  const notes = new NotesService()
  expect(notes.add('user-a', 'First')).toBe(1)
  expect(notes.add('user-a', 'Second')).toBe(2)
  expect(notes.list('user-a')).toEqual(['First', 'Second'])
})

test('stores reminder durations and content', () => {
  const reminders = new ReminderService()
  expect(reminders.add('user-a', 300, 'Make tea')).toBe(1)
  expect(reminders.list('user-a')).toEqual([{ content: 'Make tea', durationSeconds: 300 }])
})

test('increments independent counters', () => {
  const stats = new StatsService()
  expect(stats.get('ping')).toBe(0)
  expect(stats.increment('ping')).toBe(1)
  expect(stats.increment('ping')).toBe(2)
  expect(stats.get('notes')).toBe(0)
})
