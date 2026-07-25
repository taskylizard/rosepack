import { describe, expect, it } from 'vitest'
import {
  BOOTSTRAP_PUBLISH_ARGS,
  BOOTSTRAP_VERSION,
  bootstrapTag,
  isBootstrapRelease,
  isChangesetsVersionDiff,
  isUnpublishedVersion
} from '../scripts/release.mjs'

const mainWorkflowDispatch = {
  RELEASE_BOOTSTRAP: 'true',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main'
}

describe('bootstrap guard', () => {
  it('accepts the explicit bootstrap workflow on main at the initial version', () => {
    expect(isBootstrapRelease(mainWorkflowDispatch, BOOTSTRAP_VERSION)).toBe(true)
  })

  it('rejects bootstrap requests for another package version', () => {
    expect(isBootstrapRelease(mainWorkflowDispatch, '0.1.1')).toBe(false)
  })

  it('rejects bootstrap requests from a push event', () => {
    expect(
      isBootstrapRelease({ ...mainWorkflowDispatch, GITHUB_EVENT_NAME: 'push' }, BOOTSTRAP_VERSION)
    ).toBe(false)
  })

  it('rejects bootstrap requests from a non-main ref', () => {
    expect(
      isBootstrapRelease(
        { ...mainWorkflowDispatch, GITHUB_REF: 'refs/heads/feature/bootstrap' },
        BOOTSTRAP_VERSION
      )
    ).toBe(false)
  })
})

describe('bootstrap publish configuration', () => {
  it('publishes the initial package publicly on latest with provenance', () => {
    expect(BOOTSTRAP_PUBLISH_ARGS).toEqual([
      'publish',
      '--no-git-checks',
      '--access',
      'public',
      '--tag',
      'latest',
      '--provenance'
    ])
  })

  it('emits the workspace package tag format expected by Changesets', () => {
    expect(bootstrapTag('rosepack', BOOTSTRAP_VERSION)).toBe('New tag: rosepack@0.1.0')
  })
})

describe('release guard', () => {
  it('recognizes a version without its package tag as unpublished', () => {
    expect(isUnpublishedVersion('rosepack', '0.2.0', ['rosepack@0.1.0'])).toBe(true)
    expect(isUnpublishedVersion('rosepack', '0.1.0', ['rosepack@0.1.0'])).toBe(false)
  })

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
