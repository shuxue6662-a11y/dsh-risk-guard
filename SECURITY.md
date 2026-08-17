# Security Policy

## Reporting a vulnerability

Do **not** open a public issue for security vulnerabilities. Report them
privately via GitHub's [private vulnerability reporting](https://github.com/shuxue6662-a11y/dsh-risk-guard/security/advisories)
or by emailing the maintainers listed in `package.json`.

Please include:

- the dsh and plugin versions affected;
- a minimal reproduction (configuration + tool call or command);
- the impact and any suggested mitigation.

## Design notes

- The plugin never changes the host's approval policy or sandbox mode and adds
  no network calls or telemetry.
- Audit records are stored locally under `<DSH_HOME>/risk-guard/`; secret-shaped
  values are redacted before storage and only a digest of the redacted value is
  kept.
- The fuse guard is registered through `ctx.tools.guard()`, so a denial cannot
  be re-allowed by another plugin. Set `fuseEnabled: false` to disable it.
- Plugin code runs in the dsh host process with host privileges; treat this
  plugin like any other dsh plugin and review the source before installing.
