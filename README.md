# dsh-risk-guard

Zero-interruption audit + fuse blocking for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).

[![npm](https://img.shields.io/npm/v/dsh-risk-guard)](https://www.npmjs.com/package/dsh-risk-guard)
[![License](https://img.shields.io/npm/l/dsh-risk-guard)](LICENSE)
[![CI](https://github.com/shuxue6662-a11y/dsh-risk-guard/actions/workflows/verify.yml/badge.svg)](https://github.com/shuxue6662-a11y/dsh-risk-guard/actions)
[![dsh](https://img.shields.io/badge/dsh-0.1.0--rc.6-202724)](https://github.com/deepseek-ai/deepseek-harness)

## Features

- **Silent audit** — records every tool call (tool name, redacted arguments,
  success/failure, risk tags, explainable score) into local JSONL files.
  No dialogs, no permission changes, no sandbox changes.
- **Deterministic risk scoring** — zero LLM calls, zero extra cost. Covers
  destructive deletes, credential reads, network egress, writes outside the
  workspace, dependency installs and heavy builds; rapid repeats and
  consecutive high-risk calls accumulate bonus score.
- **Insurance fuse** — blocks only irreversible catastrophes before they
  execute: protected-path deletion, disk wipe/format, force-push to protected
  branches, and network commands referencing credential files.
- **Operation bill** — `/risk-guard` answers "what did my agent actually do?",
  with scores, tags, reasons and redacted details for the current session,
  one turn, or all history.

All data stays on your machine under `<DSH_HOME>/risk-guard/`. No network
calls, no telemetry.

## Install

Requires an existing [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) installation.

### Option 1 — dsh plugin manager (recommended)

```sh
dsh plugin --profile web add dsh-risk-guard
```

Restart the Web UI, then use `/risk-guard` in any session.

### Option 2 — npm

```sh
npm install dsh-risk-guard
```

or with pnpm:

```sh
pnpm add dsh-risk-guard
```

Then register the plugin in your profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: risk-guard
      name: 'dsh-risk-guard'
```

### Option 3 — from source

```sh
git clone https://github.com/shuxue6662-a11y/dsh-risk-guard.git
cd dsh-risk-guard
pnpm install
pnpm build
dsh plugin --profile web add .
```

## Usage

```text
/risk-guard              operation bill for the current session
/risk-guard --turn       only the last turn
/risk-guard --all        summary + bills for every recorded session
/risk-guard --since=2026-08-01
                         only records from this date (with any other flag)
/risk-guard --json       machine-readable output
```

The bill includes the time range, call/turn counts, high-risk and fuse-block
counts, max/total scores, tag distribution, a risky-calls table and every fuse
denial.

## Configuration

All options are optional; defaults are shown below.

| Option | Default | Meaning |
| --- | --- | --- |
| `fuseEnabled` | `true` | master switch for fuse blocking |
| `maxFileSizeMb` | `50` | gzip-archive the monthly JSONL above this size |
| `retentionDays` | `30` | delete gzip archives older than this many days |
| `cumulativeRiskWindowMs` | `600000` | rolling window for the repeat-tag risk bonus |
| `highRiskThreshold` | `60` | score floor for the consecutive-high-risk bonus |
| `workspaceRoot` | unset | detect writes outside the workspace |
| `homeDir` | OS home | home used by path rules and `~` expansion |
| `dshHome` | `~/.dsh` or `$DSH_HOME` | audit store at `<dshHome>/risk-guard` |
| `protectedBranches` | `['main', 'master']` | force-push to these branches is blocked |
| `protectedRemotes` | `[]` | force-push to these remotes is blocked |
| `credentialFileNames` | common list | `.env`, `credentials`, `id_rsa`, … |

Example:

```yaml
- insert:
    - id: risk-guard
      name: 'dsh-risk-guard'
      config:
        fuseEnabled: true
        workspaceRoot: 'C:/projects/my-app'
        protectedBranches: ['main', 'master']
```

## Fuse rules (v1)

- `rm -rf` / `del` / `Remove-Item` deleting the filesystem root, the home
  directory itself, `$HOME/*`, `DSH_HOME`, or a credential file;
- disk wipe/format commands (`dd of=/dev/sdX`, `mkfs*`, `wipefs`, `diskpart`,
  `shred /dev/…`, `format C:`);
- `git push --force` / `-f` targeting `main`/`master` or a configured protected
  remote (feature branches are **not** blocked);
- network commands (`curl`, `wget`, `nc`, `scp`, `ssh`, …) referencing a
  credential file.

Everything else runs untouched. Set `fuseEnabled: false` to disable the fuse
while keeping the audit recorder active.

## Privacy & storage

- Records are appended to `<DSH_HOME>/risk-guard/<yyyy-mm>.jsonl` through a
  serialized write queue; oversized month files are gzip-archived.
- Secret-shaped values (GitHub tokens, `sk-` keys, private-key blocks,
  `Bearer` tokens, `.env` lines, password assignments) are redacted before
  storage; only a digest of the redacted value is kept.
- The plugin makes no network calls and ships no telemetry.

## Compatibility

| Environment | Status |
| --- | --- |
| dsh `0.1.0-rc.6` (npm `next`) | tested |
| `web` profile | tested |
| `headless` profile | works (command is conditionally registered) |

## Troubleshooting

- **All tool calls crash after install** — host and profile versions of
  `@deepseek-ai/*` differ. Reinstall the plugin in the profile and run
  `pnpm dedupe`.
- **The bill is empty** — start a new turn and run a few tool calls; records
  are written asynchronously.
- **I want zero blocking** — set `fuseEnabled: false`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

MIT
