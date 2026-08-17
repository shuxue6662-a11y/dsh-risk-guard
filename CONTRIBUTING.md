# Contributing

Thanks for helping with `dsh-risk-guard`!

## Setup

```sh
pnpm install
pnpm verify   # typecheck + build + tests + package contract
```

## Making changes

- Keep changes focused: one logical change per commit.
- Every new rule, redaction pattern or report field needs a unit test.
- The Loader composition test (`tests/loader-composition.spec.ts`) is the
  official "real entry path" requirement and must stay green.
- Update both `README.md` and `README.zh.md` when user-facing behavior or
  configuration changes.
- Add a `CHANGELOG.md` entry for user-visible changes.

## Releasing

1. Bump the version in `package.json` (and add a `CHANGELOG.md` entry).
2. Commit as `chore(release): bump version to X.Y.Z`.
3. Push and tag `vX.Y.Z`; GitHub Actions verifies and publishes to npm.

The published package must keep the `dsh.bundle.patch` declaration so
`dsh plugin --profile web add dsh-risk-guard` keeps working.
