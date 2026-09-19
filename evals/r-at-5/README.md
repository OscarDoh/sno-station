# LongMemEval Retrieval

This receipt measures whether the correct memory appears among the first retrieved results for
the 500 non-abstention questions in LongMemEval-S. Higher is better.

- **R@5:** 95.4%
- **R@10:** 98.6%
- **R@20:** 99.4%
- **NDCG@10:** 87.8
- **MRR:** 88.3

The run used the product's hybrid keyword-plus-local-vector retrieval path. No answering model or
judge was used. The complete [formal-run evidence](formal-run-2026-09-09/) contains all 500
questions, gold session IDs, and the first twenty retrieved session IDs in rank order.

The public harness is not included yet, so no public rerun command is claimed.
