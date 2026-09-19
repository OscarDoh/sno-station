# Sno Memory for Codex CLI — Onboarding

This walkthrough describes the public first-run experience for `@snoai/mem-codex`.

## Start setup

Requirements:

- Codex CLI on your PATH
- Node.js 22.22.3 or newer on the 22 line, 24.15.0 or newer on the 24 line, or 25.9.0 or newer
- `git` on your PATH (memory is scoped to the repository you work in)

The one-command `Sno onboarding` install described in the repository README is not shipped yet.
Until it lands, run the three steps yourself:

```bash
npm install -g @snoai/mem-codex
npx --package @snoai/sno-station-mem sno-station-mem bind ~/.sno/sno-station-mem/$USER/memory.sqlite
sno-mem-codex install --codex-home ~/.codex
```

The npm package is the public install source. You do not need a source checkout, a private server,
or a manually copied program.

The install command is additive over your Codex configuration. It updates only its own hook
entries, trust entries, rules file, and skill, and leaves everything else in `CODEX_HOME` as it
was. There is no client configuration file.

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

Choose Agent Native to use your own Codex CLI as the memory model.

The capture worker runs `codex exec` in an ephemeral, read-only, hooks-disabled session on your
existing Codex subscription. No API key is collected and no key is stored. Every model-assisted
memory decision goes through that child process.

### REM Enhanced

Choose REM Enhanced to use the Sno GPU for the LoRA-covered extraction and conflict occasions,
with your Codex CLI covering the other model-assisted memory decisions. REM Enhanced needs Sno
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
| Capture memories | Deterministic, verbatim | Your Codex CLI | Sno extraction model |
| Classify active tasks | Keyword rules | Your Codex CLI | Your Codex CLI |
| Merge profile sections | Deterministic merge | Your Codex CLI | Your Codex CLI |
| Match completed tasks | Token overlap | Your Codex CLI | Your Codex CLI |
| Resolve conflicts | Keep both | Your Codex CLI | Sno conflict model |
| Build reflection summary | No model reflection; local session memory remains | Same | Same |
| Resolve relative dates | No model call | Your Codex CLI | Your Codex CLI |

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
`sno-mem-codex install complete` when it has written them. It then queues your existing Codex
memory notes for import; the capture worker feeds them to the store in the background. If the
notes cannot be queued, it prints that the import is deferred and the installation stays active.

The sidecar starts on demand. The first hook or memory command after install starts it and waits
for it to be healthy.

Open a new Codex session inside a git repository, then run:

```bash
sno-mem-codex doctor
```

The output has four lines:

```text
sidecar: healthy
hook trust: SessionStart=trusted-current UserPromptSubmit=trusted-current Stop=trusted-current
rules: present
import receipts: 2
```

The two import receipts are your user-level Codex notes and the repository you just opened.

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
sno-mem-codex remember "Prefer concise replies and tabs for indentation in this repository."
```

Then verify:

```bash
sno-mem-codex recall "indentation"
```

Turns you complete inside a Codex session are captured on their own after the session's `Stop`
hook fires; explicit commands are for facts you want stored right now.

Do not use temporary debug state, test output, or private infrastructure details as first memories.

## Non-interactive installs

The install command never prompts, so it is safe in scripts. `--dry-run` prints every planned
write and changes nothing:

```bash
sno-mem-codex install --codex-home /absolute/path/to/codex-home --dry-run
```

It never guesses a credential, prints a secret, or exposes a private endpoint.

## Already installed

Running the install command again is idempotent. It updates its own hook entries in place, keeps
foreign hook entries at their original position, rewrites its trust entries, rules file, and
skill, and touches nothing else.

The bind command is the opposite: it refuses when a binding exists. To change the memory mode,
see the usage guide.

Normal reinstall preserves the memory library.

## Onboarding acceptance checklist

Onboarding is complete when:

- the memory mode is recorded at bind time and Agent Native is the default;
- Local First completes without an LLM credential;
- Agent Native runs on the existing Codex subscription and collects no key;
- REM Enhanced explains the Sno-covered and Codex-covered work in public terms;
- the install command writes only its own entries and `--dry-run` changes nothing;
- `doctor` prints `healthy`, three `trusted-current` hooks, and `present` rules after a new session;
- the user can create and verify a first memory;
- no secret, private hostname, internal path, or deployment instruction appears in the output.
