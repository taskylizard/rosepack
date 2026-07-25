import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const BOOTSTRAP_VERSION = '0.1.0'
export const BOOTSTRAP_PUBLISH_ARGS = [
  'publish',
  '--no-git-checks',
  '--access',
  'public',
  '--tag',
  'latest',
  '--provenance'
]

export function bootstrapTag(name, version) {
  return `New tag: ${name}@${version}`
}

export function isChangesetsVersionDiff(changes) {
  const packageChanged = changes.some((line) => /^[AM]\s+package\.json$/.test(line))
  const removedChangeset = changes.some((line) =>
    /^D\s+\.changeset\/(?!README\.md$).+\.md$/.test(line)
  )

  return packageChanged && removedChangeset
}

export function isUnpublishedVersion(packageName, packageVersion, tags) {
  return !tags.includes(`${packageName}@${packageVersion}`)
}

export function isBootstrapRelease(env, packageVersion) {
  return (
    env.RELEASE_BOOTSTRAP === 'true' &&
    env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
    env.GITHUB_REF === 'refs/heads/main' &&
    packageVersion === BOOTSTRAP_VERSION
  )
}

function readPackage() {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
}

function publish() {
  const result = spawnSync('vp', ['exec', 'changeset', 'publish'], {
    stdio: 'inherit'
  })

  return result.status ?? 1
}

function publishBootstrap(name, version) {
  const result = spawnSync('vp', ['exec', 'pnpm', ...BOOTSTRAP_PUBLISH_ARGS], {
    stdio: 'inherit'
  })

  const status = result.status ?? 1

  if (status === 0) {
    // changesets/action uses this marker to detect a successful workspace
    // package publish and push the corresponding Git tag.
    console.log(bootstrapTag(name, version))
  }

  return status
}

function currentVersionIsUnpublished(name, version) {
  const tags = spawnSync('git', ['tag', '--list', `${name}@${version}`], {
    encoding: 'utf8'
  })

  if (tags.status !== 0) return false

  return isUnpublishedVersion(name, version, tags.stdout.split('\n').filter(Boolean))
}

function main() {
  const packageJson = readPackage()
  const packageVersion = packageJson.version

  if (process.env.RELEASE_BOOTSTRAP === 'true') {
    if (!isBootstrapRelease(process.env, packageVersion)) {
      console.error(
        `Refusing bootstrap publish: it requires workflow_dispatch on main with package version ${BOOTSTRAP_VERSION}.`
      )
      return 1
    }

    console.log(`Publishing bootstrap version ${packageVersion} to npm's latest tag.`)
    return publishBootstrap(packageJson.name, packageVersion)
  }

  if (
    process.env.GITHUB_REF === 'refs/heads/main' &&
    currentVersionIsUnpublished(packageJson.name, packageVersion)
  ) {
    console.log(`Publishing unpublished ${packageJson.name}@${packageVersion} from main.`)
    return publish()
  }

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

  return publish()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}
