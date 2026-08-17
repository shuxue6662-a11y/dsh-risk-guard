# dsh-risk-guard

Zero-interruption audit + fuse blocking for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).

[![npm](https://img.shields.io/npm/v/dsh-risk-guard)](https://www.npmjs.com/package/dsh-risk-guard)
[![License](https://img.shields.io/npm/l/dsh-risk-guard)](LICENSE)
[![Tested against dsh 0.1.0-rc.6](https://img.shields.io/badge/dsh-0.1.0--rc.6-202724)](https://github.com/deepseek-ai/deepseek-harness)

> **Tested against dsh `0.1.0-rc.6` (npm `next` tag).** dsh is in developer
> preview and ships compatibility-breaking changes; keep the `@deepseek-ai/*`
> versions of your host and this plugin aligned (see
> [Troubleshooting](#troubleshooting)).

## What it does

`dsh-risk-guard` is a **silent flight recorder + insurance fuse** for your
agent. It never adds approval dialogs, never changes your permission preset,
and never touches the sandbox. It:

1. **Records every tool call** (name, redacted arguments, success/failure,
   risk tags, explainable risk score) into local JSONL files.
2. **Scores risk deterministically** — no LLM calls, no extra API cost. Rules
   cover destructive deletes, credential reads, network egress, writes outside
   the workspace, dependency installs, and heavy builds; a cumulative bonus
   catches rapid repeats and consecutive high-risk calls.
3. **Blocks only irreversible catastrophes** with a monotonic fuse guard:
   protected-path deletion, disk wipe/format, force-push to protected
   branches, and network commands referencing credential files. A blocked
   call fails with a clear reason; you can disable the fuse entirely.
4. **Renders an operation bill** with `/risk-guard` — what the agent did, when,
   how risky it was, and why — for the current session, one turn, or all
   history.

Data stays on your machine under `<DSH_HOME>/risk-guard/`. Nothing is sent
anywhere.

## Why not just use dsh-auto-mode?

| | dsh-auto-mode | dsh-risk-guard |
| --- | --- | --- |
| Timing | live permission classification | silent audit + pre-execution fuse |
| Permission policy | adds an **Auto** preset | **does not change** approval/sandbox |
| Prompts | classifier + one-shot approvals | none by default |
| Output | approval decisions | `/risk-guard` operation bill + risk scores |
| Intelligence | LLM classifier | deterministic rules, zero LLM calls |
| Focus | fewer interruptions | traceability + irreversible-op protection |

They are complementary: `dsh-auto-mode` decides *before* a call, this plugin
remembers *after* it and blocks only the few things that should never happen.

## Install

Requires an existing [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) install.

```sh
dsh plugin --profile web add dsh-risk-guard
```

Or add it to any profile manually through `cordis.patch.yml` (see
[cordis.patch.yml](./cordis.patch.yml)).

## Usage

```text
/risk-guard              operation bill for the current session
/risk-guard --turn       only the last turn
/risk-guard --all        summary + bills for every recorded session
/risk-guard --json       machine-readable output
```

The bill shows the time range, call count, turn count, high-risk count, fuse
blocks, max/total scores, tag distribution, the risky calls table, and every
fuse denial.

## Configuration

Plugin config lives in the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: risk-guard
      name: 'dsh-risk-guard'
      config:
        fuseEnabled: true
        maxFileSizeMb: 50
        workspaceRoot: 'C:/projects/my-app'
        homeDir: 'C:/Users/me'
        dshHome: 'C:/Users/me/.dsh'
        protectedBranches: ['main', 'master']
        protectedRemotes: []
        credentialFileNames: ['.env', 'credentials', 'id_rsa']
```

| Field | Default | Meaning |
| --- | --- | --- |
| `fuseEnabled` | `true` | master switch for fuse blocking |
| `maxFileSizeMb` | `50` | month JSONL rolls into a gzip archive above this size |
| `workspaceRoot` | unset | used to detect writes outside the workspace |
| `homeDir` | OS home | home used by path rules and `~` expansion |
| `dshHome` | `~/.dsh` or `$DSH_HOME` | audit store lives at `<dshHome>/risk-guard` |
| `protectedBranches` | `['main','master']` | force-push to these branches is blocked |
| `protectedRemotes` | `[]` | force-push to these remotes is blocked |
| `credentialFileNames` | common list | `.env`, `credentials`, `id_rsa`, … |

## Fuse rules (v1)

- `rm -rf`/`del`/`Remove-Item` deleting the filesystem root, the home
  directory itself, `$HOME/*`, `DSH_HOME`, or a credential file;
- disk wipe/format commands (`dd of=/dev/sdX`, `mkfs*`, `wipefs`, `diskpart`,
  `shred /dev/…`, `format C:`);
- `git push --force`/`-f` targeting `main`/`master` (or a configured
  protected remote); feature branches are **not** blocked;
- network commands (`curl`, `wget`, `nc`, `scp`, `ssh`, …) referencing a
  credential file.

Everything else runs untouched. You can turn the fuse off with
`fuseEnabled: false`; the audit recorder keeps working.

## Privacy & storage

- Records are appended to `<DSH_HOME>/risk-guard/<yyyy-mm>.jsonl` with a
  serialized write queue; oversized month files are gzip-archived.
- Secret-shaped values (GitHub tokens, `sk-` keys, private key blocks,
  `Bearer` tokens, `.env` lines, password assignments) are redacted before
  storage; only a digest of the redacted value is kept for correlation.
- The plugin makes no network calls and ships no telemetry.

## Compatibility

| Profile | Status |
| --- | --- |
| `web` | tested via Loader composition test + `pnpm verify` |
| `headless` | works; no commands service needed (command is conditionally registered) |
| dsh `0.1.0-rc.6` | tested |

## Troubleshooting

- **All tool calls crash after install** — the host's bundled
  `@deepseek-ai/*` and the profile-installed versions may differ
  (`TOOL_RUNTIME_SCHEDULER` is a module-local symbol). Align versions
  (`dsh plugin` reinstall) and run `pnpm dedupe` in your profile.
- **The bill is empty** — start a new turn and run a few tool calls first;
  records are written asynchronously.
- **I want zero blocking** — set `fuseEnabled: false`.

## Development

```sh
pnpm install
pnpm verify   # typecheck + build + tests + package contract
```

Test suite includes a real Cordis Loader composition test (the official
"test the real entry path" requirement), unit tests for rules/redaction/
scoring/recorder/report, and rotation/archive coverage.

## Roadmap (v2 candidates)

- optional LLM classifier for ambiguous calls (opt-in, extra cost);
- token/cost budget metering;
- web dashboard for history replay;
- per-agent scoped rules.

## License

MIT
