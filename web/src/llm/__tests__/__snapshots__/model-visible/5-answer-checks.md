# Answer checks

`answerIssues` and `issuesPrompt` (answerChecks.ts) on canned replies: what the agent loop sends back, once, before a failing answer reaches the user. Each reply's number sources here are its tools' results.

Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.

## an answer that stands on its evidence

Tools run in the reply: assess_stage {"stage":"rings"}.

The answer:

```text
The ring removal needs attention: a ring is left at 3.2 Å⁻¹, {{assess_stage.rings.max_ring_left}} of the diffuse there.
```

Sent back to the model:

Nothing: the answer goes to the user, its references filled in.

## a number from nowhere

Tools run in the reply: assess_stage {"stage":"rings"}.

The answer:

```text
The ring removal needs attention: a ring is left at 3.4 Å⁻¹, 0.27 of the diffuse there.
```

Sent back to the model:

```text
Before this answer goes to the user, fix it:
- These numbers appear in no tool result or the context: 3.4, 0.27. Quote the tools' numbers, or leave them out.
Then write the whole answer again.
```

## a reference that names nothing

Tools run in the reply: assess_stage {"stage":"rings"}.

The answer:

```text
The ring removal needs attention: a ring is left at 3.2 Å⁻¹, {{assess_stage.rings.max_ring_residual}} of the diffuse there.
```

Sent back to the model:

```text
Before this answer goes to the user, fix it:
- These references name no value in this reply's tool results: {{assess_stage.rings.max_ring_residual}}. Write a reference as {{tool.field}}, the path of a field in a result above as the tool returned it (e.g. {{assess_stage.flatten.verdict}}), or quote the number itself.
Then write the whole answer again.
```

## a verdict without its tool

Tools run in the reply: qmax_coverage {}.

The answer:

```text
The flatten left no pedestal, and the window stays inside the coverage.
```

Sent back to the model:

```text
Before this answer goes to the user, fix it:
- It gives a verdict on the flatten without its evidence in this reply: call assess_stage with stage flatten, and answer from its result.
Then write the whole answer again.
```

## a verdict from before the last run

Tools run in the reply: assess_stage {"stage":"rings"}, run_pipeline {"from_stage":"rings"}.

The answer:

```text
The ring removal needs attention: a ring is left at 3.2 Å⁻¹.
```

Sent back to the model:

```text
Before this answer goes to the user, fix it:
- It gives a verdict on the ring removal from a measurement taken before the last run recomputed it: call assess_stage with stage rings again on the new outputs, and answer from that.
Then write the whole answer again.
```

## a verdict the tool contradicts, and a success the checks do not give

Tools run in the reply: assess_stage {"stage":"rings"}.

The answer:

```text
The ring removal is clean, so the 3D-ΔPDF is ready for analysis.
```

Sent back to the model:

```text
Before this answer goes to the user, fix it:
- It gives a verdict on the 3D-ΔPDF without its evidence in this reply: call assess_stage with stage pdf, and answer from its result.
- It calls the run a success, but the verdict computed from the checks is "not met: needs attention: the ring removal". That verdict is the checks', not yours: quote it as {{achieved}} and explain what it rests on.
- What it says about the ring removal contradicts the verdict the tool computed: quote that verdict and its numbers.
Then write the whole answer again.
```
