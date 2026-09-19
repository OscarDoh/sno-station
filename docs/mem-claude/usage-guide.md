# Sno Memory for Claude Code — Usage Guide

This guide covers the public npm installation, three memory modes, common commands, and safe
configuration changes for `@snoai/mem-claude`.

## Install and first run

Requirements:

- Claude Code on your PATH
- Node.js 22.22.3 or newer on the 22 line, 24.15.0 or newer on the 24 line, or 25.9.0 or newer
- `git` on your PATH

### Install

```bash
npm install -g @snoai/mem-claude
npx --package @snoai/sno-station-mem sno-station-mem bind ~/.sno/sno-station-mem/$USER/memory.sqlite
sno-mem-claude install --config-dir ~/.claude
```

The first command installs the client. The second binds the memory store once per machine user
and records the memory mode. The third writes the three hook groups and one permission rule into
`settings.json` and the skill into the Claude configuration directory.

Use the published npm package for public installs. Do not build from a private monorepo, copy a
local build to another machine, or configure a private service address.

Open a new Claude Code session inside a git repository, then check the installation:

```bash
sno-mem-claude doctor
```

Create a test memory from the repository root:

```bash
sno-mem-claude remember "Prefer tabs for indentation in this repository."
```

Verify it:

```bash
sno-mem-claude recall "indentation"
```

## The three modes

### Local First

Local First makes no LLM calls and needs no LLM credential.

- Captures deterministic, verbatim content from your turns.
- Uses deterministic rules for profile merges and task classification or matching.
- Keeps both memories when a conflict needs model judgment.
- Does not generate a model-written reflection summary.
- Resolves relative dates without a model.

The local embedder may be downloaded once on first use. After it is cached, Local First processing
does not depend on a network service.

### Agent Native

Agent Native is the default. It sends every model-assisted memory-writing occasion to your own
Claude Code.

The capture worker starts `claude -p` for each model call: one turn, hooks disabled, no tools, no
settings sources, no session persisted, working in the client's own state directory rather than
your repository. It runs on the Claude Code subscription you already have. No API key is
collected, and this client has no bring-your-own-key transport.

### REM Enhanced

REM Enhanced splits model-assisted memory work by capability. The Sno GPU handles the
LoRA-covered occasions; your Claude Code handles the rest:

- Sno handles memory extraction.
- Sno handles conflict adjudication.
- Your Claude Code handles active-task classification, profile merging, completed-task matching,
  and relative-date resolution.

If a model request fails, only that request uses its Local First behavior. The client does not
silently reroute it to another model tier.

## Routing defaults

| Occasion | Local First | Agent Native | REM Enhanced |
| --- | --- | --- | --- |
| Memory extraction | Deterministic, verbatim capture | Your Claude Code | Sno extraction model |
| Active-task classification | Keyword rules | Your Claude Code | Your Claude Code |
| Profile-section merge | Deterministic merge | Your Claude Code | Your Claude Code |
| Completed-task match | Token overlap | Your Claude Code | Your Claude Code |
| Conflict adjudication | Keep both memories | Your Claude Code | Sno conflict model |
| Reflection summary | No model reflection; local session memory remains | Same | Same |
| Relative-date resolution | No model call | Your Claude Code | Your Claude Code |

No occasion is off in Agent Native or REM Enhanced. Model-assisted writes run in the background
capture worker and fall back per request to the matching Local First behavior when necessary.

In REM Enhanced, every occasion's tier is a switch under `remEnhanced.occasions` in the bind JSON
(`snoRemMem` or `agent`). The table shows the defaults.

Two REM operations run over the store on a periodic trigger and use the Sno models in every
mode:

- `rem-update` rewrites transition narratives into current-state memories and keeps the history;
- `rem-replace` adjudicates contradictions across the store and soft-closes the loser reversibly.

Both are requested by default. `remOperations` in the bind JSON requests one, and
`remEnhanced.trigger.tick: false` turns the trigger off.

Mode selection governs memory writing. It does not make final claims about retrieval or reranker
routing.

## Change modes

The mode lives in the store binding, and the bind command refuses to overwrite one. To change it,
remove the two binding files for your user and bind again with the new mode:

```bash
rm ~/.sno/station/sno-station-mem-$USER.binding.json ~/.sno/station/sno-station-mem-$USER.config.json
echo '{"mode":"local-first"}' | npx --package @snoai/sno-station-mem sno-station-mem bind ~/.sno/sno-station-mem/$USER/memory.sqlite
```

Bind the same store path as before; the memory library is untouched. The next capture worker
registers with the new mode.

Other bind settings, all optional and all in the same JSON:

| Key | Effect |
| --- | --- |
| `mode` | `local-first`, `agent-native`, or `rem-enhanced` |
| `embedding` | Local embedder settings; never a credential |
| `retrieval` | Retrieval settings such as recall depth; never a credential |
| `rerankKeyRef` | The name of the environment variable holding a rerank key |
| `remOperations` | `["rem-update"]`, `["rem-replace"]`, or both |
| `remEnhanced` | Per-occasion tiers and the REM trigger switch |
| `autoRecallTimeoutMs` | Auto-recall deadline in milliseconds |

## Common defaults

The installation starts with:

| Setting | Default |
| --- | --- |
| Memory mode | Agent Native |
| Scope | The current repository, plus `global` |
| Embedder | Local |
| Ambient capture | On |
| Auto-recall | On |
| Session handling | Local system session memory |
| Management tools | Off |
| Cloud observability | Off |

Keep these defaults until you have a specific reason to change them. In particular, changing the
embedding model or vector dimensions requires rebuilding the stored vectors, and this client has
no reset command for that; the OpenClaw plugin ships one (`openclaw sno-mem-config embedder
wipe-db`).

## Daily operation

### Hooks

The install command registers three Claude Code hooks. Each one is scoped to the git repository
that contains the session's working directory; outside a repository, and in subagents, hooks
inject and capture nothing.

| Hook | Timeout | What it does |
| --- | --- | --- |
| `SessionStart` | 15 s | Injects up to 5 memories (at most 3,500 characters) about standing decisions, open tasks, conventions, and pitfalls for the repository; imports the repository's Claude Code memory notes on first start |
| `UserPromptSubmit` | 8 s | Injects up to 3 memories (at most 1,500 characters) relevant to the prompt; prompts shorter than 12 characters are skipped |
| `Stop` | 5 s | Spools the completed turn and starts the capture worker |

A session receives at most 12,000 characters of injected memory in total, and a memory already
shown in the session is not shown again. The injected block is labelled as data, not
instructions, and names the `get` command for reading a full entry.

Capture runs in a detached worker, not in the hook. The worker lives at most 9 minutes, gives
each model call up to 110 seconds, retries a failed turn twice (after 2 and 10 seconds), and
hands off to a fresh worker when work remains.

### Memory commands

The skill teaches Claude these four commands. Run them from inside a git repository.

| Command | What it does |
| --- | --- |
| `sno-mem-claude recall <query>` | Search repository and global memory (up to 5 results, full text with ids) |
| `sno-mem-claude get <id>` | Print one full entry and, when it was corrected, the id that supersedes it |
| `sno-mem-claude remember <text>` | Store a repository memory; prints the new id |
| `sno-mem-claude correct <id> <text>` | Store a corrected entry and mark the old one superseded; prints the new id |

There is no deletion command in this client. With `sandbox.enabled: true`, the commands cannot
reach the local sidecar and print a failure line.

### Operator commands

| Command | What it does |
| --- | --- |
| `sno-mem-claude doctor [--config-dir <dir>]` | Print sidecar health, hook state per event, permission rule state, and import receipts |
| `sno-mem-claude import --repo <absolute-root>` | Queue a repository's Claude Code memory notes for import into that repository's memory |
| `sno-mem-claude install --config-dir <dir> [--dry-run]` | Install or refresh the hook groups, permission rule, and skill |

Import reads the `.md` files in Claude Code's memory directory for the project, under
`projects/` in the Claude configuration directory. A file is imported once per content hash; a
changed file is imported again. There is no user-level import, and instruction files and
transcripts are never imported.

### Read a memory store offline

`sno-memdump` ships with the OpenClaw plugin package and reads the same store format. Running it
through `npx` fetches that package into the npx cache and installs nothing into OpenClaw:

```bash
npx --package @snoai/mem-claw sno-memdump --db ~/.sno/sno-station-mem/$USER/memory.sqlite [--scope <scope>] [--id <id>] [--grep <text>] [--limit <n>] [--metadata]
```

## Files and environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | The Claude configuration directory that `doctor` and `import` read; `install` takes it as `--config-dir` |
| `SNO_PROFILE_DIR` | `~/.sno` | The Sno profile that holds the store binding, the sidecar, and this client's state |

The install command writes into the Claude configuration directory:

- `settings.json`: one hook group per event with the absolute program path, and one
  `permissions.allow` rule of the form `Bash(<program> *)`; a missing file is created with only
  these entries, and an unparsable file is left untouched;
- `skills/sno-mem-claude/SKILL.md`: the skill Claude reads.

It never writes `CLAUDE.md`, `CLAUDE.local.md`, rules files, project memory notes, or credentials.

The client keeps its own state under `~/.sno/sno-mem-claude/`: per-session receipts, the capture
spool, the worker lock and log, correction state, import receipts, and the child working
directory. The sidecar's discovery file and startup log live under `~/.sno/station/` and
`~/.sno/sno-station-mem/`.

Use the same `SNO_PROFILE_DIR` and repository root as the Codex client to share memories between
the two.

## Reinstall and data safety

Running `install` again refreshes the owned entries and touches nothing else. Removing the
package does not remove the store.

To reinstall:

```bash
npm install -g @snoai/mem-claude
sno-mem-claude install --config-dir ~/.claude
```

The memory library is the bound store file. It is encrypted, and normal reinstall preserves it.
Back it up before any manual change to the store or the binding.

## Privacy and credentials

- Memory data is stored in encrypted local SQLite storage.
- Local First sends no memory text to an LLM service.
- Agent Native sends model-assisted memory work to your own Claude Code on your subscription.
- REM Enhanced uses Sno only for the memory-specialized occasions listed above.
- Injected memory blocks are labelled as data, not instructions.
- The bind JSON records key names, never key values; a credential in it is refused.
- Public setup never requires a private hostname, virtual-machine name, local repository path, or
  internal service token.

## Supported surfaces

Linux CLI installation and hook failure paths have real receipts. macOS CLI and Desktop
local-session support are unverified until their receipts exist. Cloud, web, SSH-hosted sessions,
and the VS Code extension are not claimed.

## Troubleshooting

### `doctor` says the sidecar is unavailable

The sidecar starts on demand. Run any memory command inside a repository, then run `doctor` again.
If it stays unavailable, read `~/.sno/sno-station-mem/sidecar-startup.log`.

### `doctor` shows `absent`, `disabled`, or `unparsable` for a hook

`absent` means the hook group is missing: run `install` again. `disabled` means `settings.json`
sets `disableAllHooks`: remove that setting. `unparsable` means `settings.json` is not valid JSON:
fix the file by hand, then run `install` again.

### A memory command prints `no-repository-root`

Memory commands and hooks work inside a git repository. Change into the repository and retry.

### A command prints `correction-in-progress`

Another `correct` for the same id has not finished. Wait for it, or retry after two minutes if it
was interrupted.

### Nothing is captured after a session

1. Confirm the session ran inside a git repository.
2. Confirm the turn had both a prompt and an assistant reply; empty turns are skipped.
3. Confirm the session was not a subagent; subagents capture nothing.
4. Read `~/.sno/sno-mem-claude/worker.log` for the capture worker's result.
5. Confirm `claude` is on the PATH of the shell that started Claude Code; the worker runs it.

### The bind command says the binding already exists

The store is already bound for this user. Change the mode as described above, or leave the binding
as it is.
