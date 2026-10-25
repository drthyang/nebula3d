# qwen/qwen3.8-27b on dev, arm B: incomplete, dropped by the user

These four runs are kept as evidence only. They are not a result.

**How they ran.**
- **Date:** 2026-10-24.
- **Model:** qwen/qwen3.8-27b in LM Studio, identifier `qwen/qwen3.8-27b`, loaded at 65,536 tokens.
- **Code:** the frozen commit 812e686a.
- **Arm:** B, one run per case.

The user dropped qwen the same day ("I think Gemma and Muse work better"), after three of the eight dev cases. Arm C and the test split were never run on it.

| File | Case | What it is |
|---|---|---|
| `dev-control_B1-timeout40` | dev-control | Hit the default 40-minute limit after 26 steps, with no answer written. A timed-out run keeps no token counts. |
| `dev-control_B1-not-fresh` | dev-control | Run again at a 90-minute limit, the manager's decision for the local models. **Not a fresh start:** the 40-minute run's outputs were still in the data root, and the model reused them. Its final answer was cut at the 16,000-token output cap. |
| `dev-ub_B1` | dev-ub | 90-minute limit. Finished in 42.7 min. |
| `dev-origin_B1` | dev-origin | 90-minute limit. Finished in 44.3 min, with its final answer cut at the 16,000-token cap. |

- **Not scored:** no `score` on the truth. The 40-minute and not-fresh runs share one dataset's outputs.
- **Speed:** qwen generates about 12 tokens a second, mostly thinking.
- **The output cap:** its final answers were cut in 2 of its 3 runs at the 90-minute limit, because the thinking fills the cap.

The counts are in [../live-2026-10-24.md](../live-2026-10-24.md).
