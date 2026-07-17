import { resolve } from 'node:path'
import { expect, test } from 'vite-plus/test'
import { parseRegistrationCliOptions } from '../src/registration-cli.ts'

test('parses guild, cache, and dry-run registration options', () => {
  expect(
    parseRegistrationCliOptions(
      ['register', '--guild', '123', '--cache', 'state.json', '--dry-run'],
      {
        DISCORD_APPLICATION_ID: 'application',
        DISCORD_TOKEN: 'token'
      }
    )
  ).toEqual({
    applicationID: 'application',
    cacheFile: resolve('state.json'),
    dryRun: true,
    guildID: '123',
    token: 'token'
  })
})

test('requires registration credentials', () => {
  expect(() => parseRegistrationCliOptions([], {})).toThrow('DISCORD_APPLICATION_ID')
  expect(() => parseRegistrationCliOptions([], { DISCORD_APPLICATION_ID: 'application' })).toThrow(
    'DISCORD_TOKEN'
  )
})
