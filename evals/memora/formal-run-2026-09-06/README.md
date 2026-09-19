# Memora formal run — 2026-09-06

This is the per-question evidence behind the public Memora result in `../result.json`.

- Run identity: `f907de1f68300676da17141a53ade05df0f7c36d-dirty-53dd3320`
- Track: weekly
- Coverage: six personas, fifteen questions each, ninety questions total
- Result: FAMA 87.2, MPA 0.9096, FAA 0.8334

`traces/` contains the assembled question, recalled memories, final answer, and score for every
question. `raw-judgments/` contains the answer, per-judge votes and reasoning, prompt hashes, and
final MPA/FAA score for the same ninety questions. `provenance.json` and `receipt.json` describe
the run and its inputs.

The public copy changes only machine-local metadata: absolute paths are repository-relative and
the loopback judge URL is written as `local-judge`. Questions, recalled memory text, answers,
scores, model names, prompt hashes, judge votes, and judge reasoning are unchanged.

The source run was recorded from a dirty working tree. Cross-system figures in the root README
use different judge stacks and are directional, not certified head-to-head results.
