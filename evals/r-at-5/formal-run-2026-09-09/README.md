# LongMemEval-S retrieval run — 2026-09-09

This is the per-question evidence behind the public retrieval result in `../result.json`.

- Run identity: `r5-hybrid-full-20260909T012556Z`
- Coverage: all 500 non-abstention LongMemEval-S questions
- Result: R@5 95.4%, R@10 98.6%, R@20 99.4%, NDCG@10 87.8, MRR 88.3

`results.json` contains each question's gold session IDs, the first twenty retrieved session
IDs in rank order, and the per-question retrieval measurements. It also contains the aggregate
and per-question-type scores.

This is retrieval-only. It does not use an answering model or a judge, and it does not measure
answer quality.
