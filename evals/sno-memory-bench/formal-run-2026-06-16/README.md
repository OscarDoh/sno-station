# Sno Memory Bench formal run — 2026-06-16

This is the probe-level evidence behind the public result in `../result.json`.

- Run identity: `bench23-r1`
- Coverage: 23 probes
- Result: 23 passed, 0 failed

`probe-results.jsonl` contains every question, final reply, verdict, reason, category, and
latency. `probes/` contains the raw model response for each probe. `scorecard.json` contains
the aggregate and category scores, and `meta.json` records the run configuration.

The public copy changes one machine-local field: the old corpus path is repository-relative.
Questions, replies, verdicts, reasons, scores, model metadata, and timings are unchanged.

This is a first-party product floor, not an independent comparison with another memory system.
