import { describe, expect, it } from 'vitest'
import { isChangesetsVersionDiff } from '../scripts/release.mjs'

describe('release guard', () => {
  it('rejects the initial repository setup', () => {
    expect(isChangesetsVersionDiff(['M\tpackage.json', 'A\t.changeset/README.md'])).toBe(false)
  })

  it('rejects unrelated package metadata changes', () => {
    expect(isChangesetsVersionDiff(['M\tpackage.json'])).toBe(false)
  })

  it('rejects deleting the Changesets documentation', () => {
    expect(isChangesetsVersionDiff(['M\tpackage.json', 'D\t.changeset/README.md'])).toBe(false)
  })

  it('accepts a Changesets version commit', () => {
    expect(isChangesetsVersionDiff(['M\tpackage.json', 'D\t.changeset/quiet-dogs-smile.md'])).toBe(
      true
    )
  })
})
