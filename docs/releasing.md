# Releasing

rosepack uses Changesets for versioning and GitHub Actions for npm publishing.

Add a changeset with `vp exec changeset` in a feature branch. After that branch is
merged, the Release workflow opens or updates a version pull request. Merging the
version pull request publishes the new version, pushes the generated tag, and creates a
GitHub release.

The publish command is guarded by `scripts/release.mjs`. It only runs when the pushed
revision changes `package.json` and removes a non-documentation changeset, so creating
the repository or pushing unrelated commits cannot publish the currently unpublished
version.

## First publish

The initial package version is `0.1.0`. After configuring npm trusted publishing and
the repository's Actions permissions, open the **Release** workflow on the `main`
branch and choose **Run workflow**. Set the `publish_bootstrap` input to `true`.

The bootstrap path is deliberately limited to a `workflow_dispatch` run on `main`
while `package.json` is still `0.1.0`. It uses pnpm's OIDC-aware publish command so
the package is actually sent to npm even though there is no Changesets release plan
yet. The script then signals the Changesets action to create the `rosepack@0.1.0`
package tag.
Leave the input disabled for all later runs; normal releases go through the Changesets
version pull request flow below.

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
