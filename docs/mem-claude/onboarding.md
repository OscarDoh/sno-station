# Sno Memory for Claude Code — Onboarding

This walkthrough describes the public first-run experience for `@snoai/mem-claude`.

## Start setup

Requirements:

- Claude Code on your PATH
- Node.js 22.22.3 or newer on the 22 line, 24.15.0 or newer on the 24 line, or 25.9.0 or newer
- `git` on your PATH (memory is scoped to the repository you work in)

The one-command `Sno onboarding` install described in the repository README is not shipped yet.
Until it lands, run the three steps yourself:

```bash
npm install -g @snoai/mem-claude
npx --package @snoai/sno-station-mem sno-station-mem bind ~/.sno/sno-station-mem/$USER/memory.sqlite
sno-mem-claude install --config-dir ~/.claude
```

The npm package is the public install source. You do not need a source checkout, a private server,
or a manually copied program.

The install command is additive over your Claude Code configuration. It updates only its own hook
groups, its one permission rule, and its skill, and leaves everything else in the Claude
configuration directory as it was. There is no client configuration file.

## Step 1: choose the memory mode

The memory mode is recorded once, when the store is bound. JSON piped into the bind command
carries it; with nothing piped in, the default applies.

The default mode is Agent Native.

```bash
STORE=~/.sno/sno-station-mem/$USER/memory.sqlite
echo '{"mode":"local-first"}'  | npx --package @snoai/sno-station-mem sno-station-mem bind "$STORE"
echo '{"mode":"agent-native"}' | npx --package @snoai/sno-station-mem sno-station-mem bind "$STORE"
echo '{"mode":"rem-enhanced"}' | npx --package @snoai/sno-station-mem sno-station-mem bind "$STORE"
```

The bind command runs once per machine user and refuses when a binding already exists.

### Local First

Choose Local First for fully local memory behavior:

- deterministic, verbatim capture of your turns;
- deterministic profile and task handling;
- no model-written reflection summary;
- no LLM credentials.

The default embedder is local. It may download its model once on first use, then runs from the
local cache.

### Agent Native

Choose Agent Native to use your own Claude Code as the memory model.

The capture worker runs `claude -p` as a single-turn child with hooks disabled, no tools, no
settings, and no session persisted, on your existing Claude Code subscription. No API key is
collected and no key is stored. Every model-assisted memory decision goes through that child
process.

### REM Enhanced

Choose REM Enhanced to use the Sno GPU for the LoRA-covered extraction and conflict occasions,
with your Claude Code covering the other model-assisted memory decisions. REM Enhanced needs Sno
access in the sidecar's environment; the bind command records only the name of the key, never its
value.

## Step 2: accept or change the remaining defaults

The install command has no prompts. The standard defaults are:

| Setting | Default |
| --- | --- |
| Memory mode | Agent Native |
| Scope | The current repository, plus a `global` scope readable everywhere |
| Embedder | Local |
| Ambient capture | On (every completed turn is captured) |
| Auto-recall | On (session start and every prompt) |
| Session handling | Local system session memory |
| Management tools | Off |
| Cloud observability | Off |

Mode-specific defaults are:

| Memory-writing occasion | Local First | Agent Native | REM Enhanced |
| --- | --- | --- | --- |
| Capture memories | Deterministic, verbatim | Your Claude Code | Sno extraction model |
| Classify active tasks | Keyword rules | Your Claude Code | Your Claude Code |
| Merge profile sections | Deterministic merge | Your Claude Code | Your Claude Code |
| Match completed tasks | Token overlap | Your Claude Code | Your Claude Code |
| Resolve conflicts | Keep both | Your Claude Code | Sno conflict model |
| Build reflection summary | No model reflection; local session memory remains | Same | Same |
| Resolve relative dates | No model call | Your Claude Code | Your Claude Code |

No memory-writing occasion is disabled in Agent Native or REM Enhanced. A failed model request
uses the corresponding Local First behavior for that request instead of switching model tiers.

In REM Enhanced, each occasion's tier is a switch under `remEnhanced.occasions` in the bind JSON.
The defaults above are the release targets; changing one is a configuration decision, not a code
change.

Two REM operations run over the store on a periodic trigger and use the Sno models in every
mode:

- `rem-update` rewrites transition narratives into clean current-state memories while keeping the
  history;
- `rem-replace` adjudicates contradictions across the store and soft-closes the losing memory
  reversibly.

Both are requested by default. Set `remOperations` in the bind JSON to request one, and set
`remEnhanced.trigger.tick` to `false` to turn the trigger off.

The mode choice does not finalize retrieval or reranker behavior.

## Step 3: complete setup and verify

The install command prints one `would write` line per planned file with `--dry-run`, and
`sno-mem-claude install complete` when it has written them. When `settings.json` cannot be parsed,
it leaves that file byte-for-byte as it was, still installs the skill, and prints one line saying
the settings were preserved.

The sidecar starts on demand. The first hook or memory command after install starts it and waits
for it to be healthy.

Subagents and sessions outside a git repository inject and capture nothing. A session with
`sandbox.enabled: true` is unsupported: its memory commands cannot reach the local sidecar, so
turn the sandbox off or expect a failure line.

Open a new Claude Code session inside a git repository, then run:

```bash
sno-mem-claude doctor
```

The output has four lines:

```text
sidecar: healthy
hooks: SessionStart=present UserPromptSubmit=present Stop=present
permission rule: present
import receipts: "/absolute/path/to/repository"=present
```

The import receipt names the repository you just opened; its Claude Code memory notes were
imported on that first session start.

## Step 4: create the first useful memory

Start with information that will help every day:

- preferred language and tone;
- coding and review preferences;
- project rules;
- package-manager rules;
- preferred tools or commands;
- actions the agent should not repeat.

Store it explicitly from the repository root:

```bash
sno-mem-claude remember "Prefer concise replies and tabs for indentation in this repository."
```

Then verify:

```bash
sno-mem-claude recall "indentation"
```

Turns you complete inside a Claude Code session are captured on their own after the session's `Stop`
hook fires; explicit commands are for facts you want stored right now.

Do not use temporary debug state, test output, or private infrastructure details as first memories.

## Non-interactive installs

The install command never prompts, so it is safe in scripts. `--dry-run` prints every planned
write and changes nothing:

```bash
sno-mem-claude install --config-dir /absolute/path/to/claude-config --dry-run
```

It never guesses a credential, prints a secret, or exposes a private endpoint.

## Already installed

Running the install command again is idempotent. It updates its own hook groups in place, keeps
foreign hook groups at their original position, keeps exactly one permission rule of its own,
rewrites its skill, and touches nothing else.

The bind command is the opposite: it refuses when a binding exists. To change the memory mode,
see the usage guide.

Normal reinstall preserves the memory library.

## Supported surfaces

Linux CLI installation and hook failure paths have real receipts. macOS CLI and Desktop
local-session support are unverified until their receipts exist. Cloud, web, SSH-hosted sessions,
and the VS Code extension are not claimed.

## Onboarding acceptance checklist

Onboarding is complete when:

- the memory mode is recorded at bind time and Agent Native is the default;
- Local First completes without an LLM credential;
- Agent Native runs on the existing Claude Code subscription and collects no key;
- REM Enhanced explains the Sno-covered and Claude-covered work in public terms;
- the install command writes only its own entries and `--dry-run` changes nothing;
- `doctor` prints `healthy`, three `present` hooks, and a `present` permission rule after a new
  session;
- the user can create and verify a first memory;
- no secret, private hostname, internal path, or deployment instruction appears in the output.
