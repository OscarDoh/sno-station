# Full ownership handoff: Sno Memory for Claude Code

## Authority and release contract

Direct owner task; NO original work card exists. No transfer card/cancellation is required. Sender: `sender-seat`. Receiver: `receiver-seat`, vendor MUST be Claude. Checkout MUST remain `<repo>`. Final results go to the owner in the receiver's visible session in this checkout; identify this inherited direct task. Do not ask the sender to resume or act as supervisor.

Owner explicitly invoked `the workflow skill` on `ai-doc/ACTIVE/PRD/mem-claude/the client-code-prd.md`, `$join-talk`, and said: "Commit and check the box in tasks.md after every completed task, not per slice." Commit authorized; push NOT authorized. Owner mandated all agents reuse `<repo>/apps/mem-codex/src`; do not reinvent. Pass that to every helper/reviewer. Owner now sent: "ROTATE: hand off to claude now. Your Codex weekly quota is at 2% remaining and will not last the task. Stop editing. Run the handoff skill ($handoff): write the brief, spawn a claude receiver in this same checkout, verify its readiness, then release it. Before any receiver write, the receiver must print HANDOFF_RELEASED <nonce> on its own line. Report the receiver seat address and the brief path here, then unregister and stop."

Read this entire file and verify exact bytes, SHA-256 and EOF marker supplied in the launcher. Make NO TASK WRITES before explicit release. On release recheck digest and no-card identity, then print standalone `HANDOFF_RELEASED <release nonce>` BEFORE any task write. Sender will unregister and cease work. No competing writers are authorized.

All helper agents are stopped/idle. `claude_tests` was interrupted immediately on ROTATE before its proposed review fixes; snapshot shows no edits to install/STP2/STP4 yet. `claude_worker` and `claude_install` completed. These were native Codex harness agents despite names; do not rely on their availability in Claude. Their completed code is on disk. No active E2E/review/test processes remain: STP5, STP7, test review and local checks all finished.

## Rules and scope

Read AGENTS.md / CLAUDE.md and named skills. Reply in Chinese, concise, before actions; code/files English. One owner question at a time. Reuse existing source before adding code. No writes to `apps/mem-codex` or `packages/sno-station-mem`. Only new app, new Claude tests, PRD/OpenSpec, workspace lock in scope. No existing test suites or benchmarks. Do not touch host `~/.claude`, `~/.codex`, OpenClaw config. Mac mac-host is LAST step, only after Linux proven, and owner must name Desktop config/store paths before any write. No Mac connection has been made. No fabricated completion or lowered acceptance. Per-task checkbox AND commit immediately, no pushes. 24h agent wall-time budget from PRD, not near exhausted.

Skills already applied: the workflow skill; join-talk (sender seat registered); less-is-more; codex-coder/ts-coder; independent test-writer; code-simplifier; peer-review. One plan review completed and dispositioned. ONE test review has now completed; DO NOT rerun review on these files. Fix directly and run affected checks. Final archive/terminal-close only with true acceptance.

Unrelated `/tmp/sno-prd30-finish/CHECKLIST.md`: zero unmet, five historical given-up items; not authorization to rerun unrelated PRD30 tests.

## Snapshot and current progress

Snapshot siblings: status.txt, staged.patch, unstaged.patch, untracked-sha256.json, head.txt, checkout.txt. HEAD `92348bf46f19d20ca72a152461792386a801f873`. Baseline before this journey `6b5fd033d`. Preserve all current files. No source changes committed to forbidden Codex/sidecar paths.

OpenSpec: `openspec/changes/the client-code-prd/`. PRD v1.2, project_status in_progress. 21/27 tasks checked (about77.8%). Latest user's earlier status-only question was answered at16/27=59.3%; subsequent tasks continued. Checked implementation, Linux install/injection/commands/import/shared-store tests and proofs. Unchecked3.2/3.3 (native child acceptance unresolved),6.1(Mac),8.1(test review fixes),8.2(final verification),8.3(archive/close).

Canonical acceptance: `ai-doc/ACTIVE/PRD/mem-claude/sidecar/the client-code-prd.acceptance.json`. All rows true EXCEPT QCG-6 (native child token metric) and QCG-12(Mac). QCG-7 not defined. Must use Creator `prd-proof.py`, never manually set passes. Some already true rows need verifier rerun after test-review fixes below. Body edits invalidate proof body hashes: rebind using actual current verifiers, do not invent receipts.

Source app at apps/mem-claude has15 modules copied/adapted from Codex, build/typecheck/lint passed. Shared connection and scope files byte-identical to Codex. Claude hooks, prompt_id capture, repo-only import, absolute Bash permission. Worker child neutral directory, hooks disabled, no settings sources, no CLAUDECODE, Git ceiling to app state root (host home itself is a Git repo). CLI flush+exit avoids dangling HTTP, worker9min lifetime,110s child allowance, incumbent retries2s/10s and retained failures. No new store/backend. Settings validation returns original object to preserve foreign key order. Root lock only adds new workspace entries.

Important commits (chronological): ebd178378 projection;8025589b7 foundation;dfb19b6ff foreign settings order;66fb3c414 STP1 tests;2178797ca STP1 proof;6579b632a injection source;2a1660495 worker lifetime;f3f5b03cf explicit source;ed2871be0 import source;ecdd22cc2 Git child ceiling;f639033f8 lock; c100a61b0 STP2 tests;d7ca7000b proof;faa1100c6 STP4 tests;25bffa32c proof;ffa357b7b OpenSpec format;855752f65 shared source;fe075d17c shared tests;d21d3a5d6 shared proof;6fe1d06db import tests;92348bf46 import proofs. No pushes.

## Running environment

Local Node v24.18.0. Remote `linux-host`, Node24.21.0, Claude2.1.268. Shared sidecar profile `~/.the other client-e2e`, unit `sno-station-mem-mem-codex-e2e.service`, last guarded PID902709 active, one process. Sidecar bundle `~/the other client-e2e/sno-station-mem`, entry vendor/sno-station-mem/dist/sidecar/main.js. Keep the same profile. No new service/profile. Unit intentionally stopped once in STP1 and restored. All runtime files restored after negative controls.

App remote `~/the client-e2e/app`; binary `~/the client-e2e/bin/the client` symlink app/dist/cli.js; node_modules symlink existing sidecar bundle node_modules. Latest source deployed (Git-ceiling included), no source edits since. Deploy only if source changes: build app, rsync dist skills package.json README, chmod755 remote dist/cli.js afterward (rsync can reset mode).

[credential line removed]

Remote mode agent-native; worker-harness nativeMode checks first and no-ops when already correct. Observe real children via test wrapper, stdin/stdout forwarded unchanged. Sidecar guard checks actual PID every phase.

## Test/proof state and evidence

New tests only: tests/apps/mem-claude/{install.test.ts(6),recall.test.ts(8),import.test.ts(3),worker.integration.test.ts(7)}. Most recent combined run all24 passed on local real temporary sidecar (only external model child stubbed). Full command/status/output in change/evidence/verification-output.md. Worker test includes actual2s import pacing with instant child, real retry2s/10s, actual subprocess failures, real lock/deadPID/race. That file still untracked because its owning STP3 tests task not yet checked.

E2E tests/evidence:
- STP1 real wrong-key red/restore, hook prompt_id/Stop equality, isolated nonrepo, disabled autostart+sidecar down, original config untouched.
- STP2 real /compact works after3 dialog turns (/compact with one pair gave Not enough messages), /clear changes session_id. Scope, dedup, compaction receipts passed but review corrections pending. Historical STP2 receipt metadata app_commit corrected to ed2871be0 with original preserved and15 deployed JS hashes proving attribution; functional bytes unchanged. Later runners freeze appCommit at start.
- STP3 QCG4 capture A/B+early exit defect passed. QCG11 local worker suite passed. QCG6 real paths observed, but false metric (see pending decision).
- STP4 real model Bash tool_use/tool_result (not final answer alone), permissions missing/relative deny, correction, shell/global readback passed. Review quote matcher fix pending.
- STP5 latest real run PASSED QCG8/14, canonical proofs updated. Raw `/tmp/the client-stp5-distinct-fact.txt`, receipt evidence/stp5-linux-host.json. Initial memory3 files→real SessionStart→committed+recall, repeat0, changed file1, absent0, >=2s pacing, projectglobal leak negative then restored isolation. Wrapper now saves passed:false partial receipt on failure and verifier rejects it. Do not rerun without reason.
- STP7 real existing Codex fact (no seeding first direction) plus reverse write/read and cwd-scope defect+restore PASSED canonical QCG17. Original fact ID<redacted>, DOGFOOD_TEAL, repo `~/the other client-e2e/repos/dogfood-sample`. Codex binary `~/the other client-e2e/bin/the other client`. Raw `/tmp/the client-stp7-run.txt`, evidence/stp7-linux-host.json.

Raw evidence directory `ai-doc/ACTIVE/PRD/mem-claude/evidence/` about2.4MB, currently untracked; preserve, inspect for secrets before any eventual commit. Canonical proof JSONs may be ignored but exist. Change/evidence contains source/test/proof summaries. No Mac receipts exist.

## Pending owner decision: child input metric

An asynchronous question was sent; NO ANSWER as of release. Do not treat default selection or elapsed time as authorization. Question in Chinese asks whether to replace whole-child `<5000 cache_creation_input_tokens` with fixed-client overhead plus neutral-directory/no-hook proof. Options: recommended measure fixed overhead; or keep total and expand to shorten sidecar extraction prompt (outside current scope).

Facts: QCG6 real normal children input bytes10629,28777,25761,35704 and cache_creation6914,13980,12404,13517; git_root null and isolation flags correct. Real tiny26-byte same-flags baseline cache_creation3369, input_tokens2, no repo. Service extraction prompt itself long. PRD QCG6 explicitly demands below5000; no source/test weakening authorized. Raw child baseline JSON/JSONL and STP3QCG6 receipt are preserved. Current QCG6 verifier correctly fails, canonical false.

Killed-child test initially expected signal SIGTERM; actual Claude exits143 after real SIGTERM. Test corrected to allow signal or143 AND killed timestamp ordering. Actual callback503, retry+commit19.936s observed; do not claim full QCG6 green because metric false. Native function/missing hooks/plant+restore all measured. If owner approves metric revise, patch PRD/acceptance/spec consistently via creator, retain originals, update verifier, run actual authorized proof and rebind other body-hashed receipts. Then task3.2/3.3 each own commit.

## Incidents preserved, no new product mechanisms

1. Prior verbose STP4 model session automatic capture hit inner sidecar30s timeout three times, retained failed spool correctly. Explicit CLI writes/readbacks still succeeded independently. Verified session HMAC attribution without printing salt. Client child110s does not override sidecar inner30s (incumbent Codex same). Exact failed record moved byte-identically to remote evidence/retained-failed-spool, SHA dbc7bad98dd83a84afb15c6c847fb42412cf294b53eb1486857c35c5b9496f4a. Local receipt and journal selected events preserved. No deletion/replay/config change. STP5 idle precondition now errors immediately on terminal failed spool without a live worker, instead of waiting590s.
2. First STP5 changed fact persisted, but ranked6/17 in recall where both clients use limit5. Two same-repo and3 allowed globals outranked; raw50-limit includes it, directget works. Not client filtering/drop. Diagnostic change/evidence/import-readback-diagnosis.md and raw recall/stages JSON. QCG14 requires changed-hash import, NOT old-fact correction/supersession. Independent test author replaced changed telescope-label variant with distinct durable emergency-assembly-point fact; still exact nonce through unchanged default CLI, all hashes/counts/isolation preserved. Latest full real rerun green. No source/recall-limit change.

## One test review completed: repair, NO second review

Authoritative full report: `openspec/changes/the client-code-prd/evidence/test-review.md` (also /tmp/the client-test-review.md). Script used REVIEW_KIND=test MAX_FILES_PER_WAVE23 PAYLOAD_LIMIT180000, all23 new test files one wave, CONTEXT_FILE /tmp/the client-test-review-context.md. Review completed, not ongoing. Preserve every finding, disposition based on evidence, no repeat review. Five findings:
1. STP2 compact OR assertion permits empty SessionStart block then next prompt injection; must prove compact startup block itself restored a known previously injected fact.
2. install test title claims in-place update but own entries never stale; alter own timeouts/content so real update is needed and assert preserved foreign positions.
3. STP4 runner+verifier raw string matching fails legal quotes around UUIDs; accept legal quoted arguments while still requiring matching actual tool_use and successful tool_result.
4. unrelated prompt assertion may only prove ledger dedup because all fixture facts already seen; ensure an unseen irrelevant fact exists and remains excluded.
5. STP2 assumes arbitrary five standing facts keep target outside start top5; not guaranteed by contract, causes false failures.

Test author proposed, NOT IMPLEMENTED before ROTATE:
- Use existing real-hook observation wrapper: after real SessionStart command returns but BEFORE forwarding to host/UserPromptSubmit, ordinary `remember` seeds one query fact. Preserve actual stdin/stdout and record seed ID/time separately. Therefore target did not exist during startup; no ranking assumption; works even --resume emits SessionStart.
- For unrelated prompt, analogous after-SessionStart new irrelevant fact, prove original ledger lacks it and ordinary get/recall sees it.
- Keep standing fact A actually injected on first start; compact/restored compact SessionStart must contain A, reset-negative must omit A. Query fact B reinjection proof remains.
No writes to these files show in snapshot: proposal awaits receiver judgment/execution. Source implementing agent may not author own tests per the workflow skill: use fresh independent test-writer receiver helper if needed. All new helper brief must include incumbent Codex reuse mandate.

After fixes run only affected unit/E2E journeys and update canonical verifiers. Preserve old receipts before new STP2/STP4 runs. Ordinary long model roundtrip may trigger known30s automatic Stop capture failure; diagnose/preserve without claiming success or changing shared config. Review task8.1 only complete after findings dispositioned and checks green, then checkbox+commit.

## Evidence formatting repair started, NOT yet applied

Ran public `task-evidence-gate --mode audit --change the client-code-prd`. It refuses old task evidence clauses because no backtick output anchors,0.2/0.3 no evidence/ path; this is metadata format, NOT absent functional runs. Tool parses only fenced blocks containing `$ command`, immediate `status=<integer>`, then output. Every backtick token after literal evidence: is either evidence/ path or literal output anchor; an ai-doc path in backticks is mistakenly interpreted as anchor.

Created `change/evidence/verification-output.md` with ACTUAL current subprocess commands/status/output: PRD lint clean1source-order warning; OpenSpec strict valid; npm workspace; app typecheck/lint; all24 focused tests; existing real-receipt verifiers1,9,2,3,4,5,16,17. All passed. No edit yet to old tasks evidence refs. Most recent5.2/5.3 refs already use proper anchors/fenced output. Plan: preserve old summaries, add shared evidence/verification-output.md and exact actual output anchor to each completed task; remove backticks around non-evidence paths/commands in clause unless actual output matches. Add missing0.2/0.3 evidence path. For3.1a use actual Git boundary command/output (original evidence gives before ~ exit0; after ceiling fatal notgit exit128). Do not fabricate command output. Rerun evidence gate, then commit metadata repair as own completed task if added; never fake status values.

`code-check.sh` rejects .mjs as unsupported (.py/.ts/.tsx/.mts supported). This was actually tried and explicitly documented in modified stp7-tests.txt. .mjs checked with node --check and Biome; do not report code-check itself passed. Source TS code-check15files passed foundation. Current combined24tests raw command evidence available; later install review edit invalidates its install subsection only, rerun affected.

## Remaining finish path

Continue independent authorized repairs. Need owner answer for metric and later Desktop host/profile. Mac is last, owner must name Desktop config/store paths and whether everyday store may receive test memories; do not assume. Could reuse local incumbent Codex macOS harness, no Mac scripts created yet. Actual Desktop local session screenshot+hook receipt+store readback required; CLI cannot substitute.

Then final source typecheck/lint, affected tests, actual CI/review status (no PR claimed), head/base forbidden-scope and secrets/disabledtests/counts check, less-is-more cut own diff. Check task evidence. Commit each completed task separately. Archive via openspec-archive-change only when truly done, exact the workflow skill terminal-close block with actual owner kickoff authority, no fake approval or pushes. Do not stop at partially green Linux. Report unresolved owner decision plainly while keeping independent work moving.

Useful commands:
`npm run typecheck --prefix apps/mem-claude`
`npm run lint --prefix apps/mem-claude`
`npm run build --prefix apps/mem-claude`
`node_modules/.bin/vitest run tests/apps/mem-claude/<file>`
`node tests/apps/mem-claude/e2e/run-stpN-e2e.mjs`
`python3 ~/.agents/skills/the workflow skill/scripts/prd-proof.py <PRD> QCG-n -- <exact verifier>`
`openspec validate the client-code-prd --strict`


## Handoff protocol recovery: authoritative latest state

The first receiver release turn failed the owner protocol: receiver wrote tests before printing HANDOFF_RELEASED. Sender did NOT resume task edits or revert those changes. Sender used cooperative acpx cancel, then an explicit PAUSE. Receiver acknowledged standalone HANDOFF_PAUSED_0e52 and ended that turn. This recovery supersedes ALL prior queued continuation/release instructions. Old nonce MEMCLAUDE_RELEASE_6fb1e902 must not be used as a successful receipt.

Receiver edits are preserved. New snapshot in retry-snapshot/ is the authoritative current tree; initial snapshot remains historical. Inspect the diff after proper release to see which review fixes are already applied; do not overwrite them or assume all tested. Head and status follow exactly from the new snapshot. Original brief descriptions of unimplemented test fixes now mean before the premature receiver turn; this section supersedes them.

The next readiness turn must read and verify this entire refreshed brief and return only the requested READY nonce, digest and checkout, then END THE TURN without task writes. The next release turn must recheck digest read-only, print the fresh HANDOFF_RELEASED nonce on its own line, then END THAT ACKNOWLEDGMENT TURN WITHOUT TASK WRITES. Sender will observe the receipt, deliver a continuation wake under that already-released authority, unregister, and stop. After the continuation wake receiver owns all remaining authorized work. This two-step receipt/continuation sequence prevents task work from delaying or replacing the required release acknowledgment. No new owner approval or work card is needed.

Current snapshot HEAD:
92348bf46f19d20ca72a152461792386a801f873

Current snapshot status:
```text
 M openspec/changes/the client-code-prd/evidence/stp7-tests.txt
 M tests/apps/mem-claude/e2e/harness.mjs
 M tests/apps/mem-claude/install.test.ts
?? ai-doc/ACTIVE/PRD/mem-claude/evidence/child-baseline-linux-host.jsonl
?? ai-doc/ACTIVE/PRD/mem-claude/evidence/child-baseline-result-linux-host.json
?? ai-doc/ACTIVE/PRD/mem-claude/evidence/compaction-linux-host.json
?? ai-doc/ACTIVE/PRD/mem-claude/evidence/preflight-linux-host.json
?? ai-doc/ACTIVE/PRD/mem-claude/evidence/retained-failed-spool-receipt.json
?? ai-doc/ACTIVE/PRD/mem-claude/evidence/retained-failed-spool-timeout-events.json
?? ai-doc/ACTIVE/PRD/mem-claude/evidence/stp1-linux-host.json
?? ai-doc/ACTIVE/PRD/mem-claude/evidence/stp2-linux-host-original-metadata.json
?? ai-doc/ACTIVE/PRD/mem-claude/evidence/stp2-linux-host.json
?? ai-doc/ACTIVE/PRD/mem-claude/evidence/stp3-qcg-4-linux-host.json
?? ai-doc/ACTIVE/PRD/mem-claude/evidence/stp3-qcg-6-linux-host.json
?? ai-doc/ACTIVE/PRD/mem-claude/evidence/stp4-linux-host.json
?? ai-doc/ACTIVE/PRD/mem-claude/evidence/stp5-first-import-failure.txt
?? ai-doc/ACTIVE/PRD/mem-claude/evidence/stp5-linux-host.json
?? ai-doc/ACTIVE/PRD/mem-claude/evidence/stp5-recall-responses.json
?? ai-doc/ACTIVE/PRD/mem-claude/evidence/stp5-retrieval-stages.json
?? ai-doc/ACTIVE/PRD/mem-claude/evidence/stp7-linux-host.json
?? ai-doc/ACTIVE/PRD/mem-claude/evidence/worker-integration-workstation.txt
?? openspec/changes/the client-code-prd/evidence/import-readback-diagnosis.md
?? openspec/changes/the client-code-prd/evidence/retained-capture-failure.md
?? openspec/changes/the client-code-prd/evidence/test-review.md
?? openspec/changes/the client-code-prd/evidence/verification-output.md
?? tests/apps/mem-claude/e2e/run-stp3-e2e.mjs
?? tests/apps/mem-claude/e2e/verify-stp3-receipt.mjs
?? tests/apps/mem-claude/worker.integration.test.ts
```

<!-- AGENT_CUTOVER_EOF -->
