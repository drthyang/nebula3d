# The review's findings and decisions

One JSON file per finding, so that pull requests adding findings never touch the
same file.

- **The findings recorded before the split** keep their order through a number:
  `001-dev-control.json` to `034-P4.12b.json`.
- **A finding added since** is named after its `ref`, for example `P4.12c.json`,
  and sorts after the numbered ones.

Each file holds one entry, written as `JSON.stringify(entry, null, 1)` plus a
newline. The loader is `web/src/llm/evals/reviewFindings.ts`, which reads the
files in name order. `findings.test.ts` holds every entry to its schema, by its
`source`, and checks the names and the layout.

The held-out scan (`tests/test_validation.py`) reads this folder: no finding
names a test case.
