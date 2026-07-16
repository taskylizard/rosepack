import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function isChangesetsVersionDiff(changes) {
  const packageChanged = changes.some((line) => /^[AM]\s+package\.json$/.test(line))
  const removedChangeset = changes.some((line) =>
    /^D\s+\.changeset\/(?!README\.md$).+\.md$/.test(line)
  )

  return packageChanged && removedChangeset
}

function main() {
  const baseSha = process.env.RELEASE_BASE_SHA?.trim()

  if (!baseSha || /^0+$/.test(baseSha)) {
    console.log('Skipping publish: no previous revision is available.')
    return 0
  }

  const baseRevision = spawnSync('git', ['cat-file', '-e', baseSha + '^{commit}'])
  if (baseRevision.status !== 0) {
    console.log('Skipping publish: the previous revision is not available.')
    return 0
  }

  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', baseSha, 'HEAD'])
  if (ancestor.status !== 0) {
    console.log('Skipping publish: the previous revision is not an ancestor.')
    return 0
  }

  const diff = spawnSync(
    'git',
    ['diff', '--name-status', baseSha, 'HEAD', '--', 'package.json', '.changeset'],
    {
      encoding: 'utf8'
    }
  )

  if (diff.status !== 0) {
    process.stderr.write(diff.stderr)
    return diff.status ?? 1
  }

  const changes = diff.stdout.split('\n').filter(Boolean)

  if (!isChangesetsVersionDiff(changes)) {
    console.log('Skipping publish: this is not a Changesets version commit.')
    return 0
  }

  const publish = spawnSync('vp', ['exec', 'changeset', 'publish'], {
    stdio: 'inherit'
  })

  return publish.status ?? 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}
