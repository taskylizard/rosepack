# Releasing

Rosepack uses Changesets for versioning and GitHub Actions for npm publishing.

Add a changeset with `vp exec changeset` in a feature branch. After that branch is
merged, the Release workflow opens or updates a version pull request. Merging the
version pull request publishes the new version, pushes the generated tag, and creates a
GitHub release.

The publish command is guarded by `scripts/release.mjs`. It only runs when the pushed
revision changes `package.json` and removes a non-documentation changeset, so creating
the repository or pushing unrelated commits cannot publish the currently unpublished
version.

## npm trusted publisher

Configure the existing `rosepack` package on npm with these values:

- Provider: GitHub Actions
- Organization or user: `taskylizard`
- Repository: `rosepack`
- Workflow filename: `release.yml`
- Environment: none
- Allowed action: `npm publish`

The workflow grants `id-token: write` and publishes with pnpm's OIDC support. No npm
token or repository secret is required. The public repository and package metadata also
allow npm to generate provenance automatically.
