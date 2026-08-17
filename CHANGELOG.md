# Changelog

## Unreleased (0.2.0)

- `feat(rules)`: block destructive `git reset --hard` to protected refs and
  `git clean -fdx` on protected paths.
- `feat(rules)`: Windows deletion coverage (`del`/`rd` flags and
  `%USERPROFILE%` expansion).
- `feat(redact)`: mask JWTs, npm tokens and Slack tokens.
- `feat(config)`: make the cumulative-risk window and high-risk floor
  configurable (`cumulativeRiskWindowMs`, `highRiskThreshold`).
- `feat(report)`: add risk-level breakdown and `--since=` history filtering.
- `feat(recorder)`: prune gzip archives beyond `retentionDays`.
- `chore(docs)`: add SECURITY.md, CHANGELOG.md and CONTRIBUTING.md.

## 0.1.2 — 2026-08-17

- Rewrite READMEs as user-facing docs with npm install instructions.

## 0.1.1 — 2026-08-17

- Package metadata only (CI release pipeline validation).

## 0.1.0 — 2026-08-17

- Initial release: silent JSONL audit, deterministic risk scoring, monotonic
  fuse guard, `/risk-guard` operation bill, local-only storage.
