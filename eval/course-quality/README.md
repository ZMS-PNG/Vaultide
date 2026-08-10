# Course quality release gate

This evaluator applies two independent gates:

1. **Absolute contract**
   - 9-12 complete scenes;
   - every scene scores at least 90;
   - complete-course scene average is at least 93;
   - normalized grounding and citation accuracy are both at least 95;
   - final synthesis and transfer are delivered;
   - no blank, filler, duplicate, or untraceable critical content.
2. **Accepted-benchmark contract**
   - candidate score is at least five points above the average of all four
     accepted reference courses;
   - no core quality dimension is lower than the corresponding four-course
     benchmark average.

The four accepted references are fixed by identity:

- `codex-architecture-task-flow` — Codex 架构与任务流程
- `grok-build-quickstart` — Grok Build 快速上手
- `grok-build-introduction` — Grok Build快速入门
- `code-agent-verification-paper` — 代码代理自动验证论文精读

Run the gate with exported classroom snapshots:

```bash
pnpm --silent eval:course-quality -- \
  --scenario external-github \
  --candidate candidate.json \
  --baseline codex-architecture-task-flow=benchmarks/codex.json \
  --baseline grok-build-quickstart=benchmarks/grok-quickstart.json \
  --baseline grok-build-introduction=benchmarks/grok-introduction.json \
  --baseline code-agent-verification-paper=benchmarks/code-agent-paper.json \
  --output artifacts/course-quality-external-github.json
```

Local paths and authenticated HTTP(S) classroom snapshot URLs are accepted.
When `ACCESS_CODE` is present, the runner sends it as
`x-openmaic-access-code`.

The silent command writes exactly one versioned JSON report to stdout.
`--output` writes the same machine-readable report to disk. A blocked release
exits with status 1.
