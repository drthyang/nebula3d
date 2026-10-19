# Tool results and goals with the skills off (validation arm C)

Arm C's text where it differs from arm B's: the stages' goals, a stage's result that carries one, the calls arm B's skill gate refuses, read_skill called by name, and the tuning prompt for the flatten. Each tool is called through `runToolCall` with the skills' switch off (`skills: false` in its context) and the tools `toolsWithSkills(CHAT_TOOLS, false)` gives; every other tool's result is as in 4-tool-results.md, since no other result carries a skill's text.

Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.

## The stages' goals with the skills off

`STAGE_GOALS_WITHOUT_SKILLS` (tune/prompts.ts; `WORDS.goalWithoutSkills`, verdicts/rules.ts): in assess_stage's single-stage result and the tuning prompts.

### rings

As in arm B (3-goals-and-verdicts.md).

### punch

As in arm B (3-goals-and-verdicts.md).

### backfill

As in arm B (3-goals-and-verdicts.md).

### flatten

```text
Bring the per-|Q|-shell floor to about 0 and level across |Q| (floor_after near 0 in all thirds) without over-subtracting (floors well below 0), and leave no pedestal: max_floor_trend (|rank correlation| of the floors with |Q|, over the outer half of the shells the counts reach) well below 1 and max_floor_span_fraction well below 1 (pedestal_left false). after_floor_max_sigma is the floors in the cut's own σ, which the diffuse sets: it reads above 1 on sound flattens and is no goal by itself. A trend near 1 with a span near 1 or more is a background the model missed, however small it reads in σ.
```

### pdf

As in arm B (3-goals-and-verdicts.md).

## assess_stage {"stage":"flatten"}

The flatten's result, its goal with the skills off.

```json
{
  "flatten": {
    "verdict": "meets its goal",
    "criterion": "No pedestal: a floor trend and a span both 0.8 or more over the outer half of the |Q| shells the counts reach. The largest floor in σ is reported, not judged: σ is the cut's own spread, and the floors follow the diffuse level (the 1σ limit dropped at the user's choice, 2026-10-17; provisional).",
    "headline": "floor ≤ 2.78σ · trend ≤ 0.333 · span ≤ 0.17 · no pedestal",
    "max_after_floor_sigma": 2.78,
    "max_floor_trend": 0.333,
    "max_floor_span_fraction": 0.17,
    "pedestal_left": false,
    "per_plane": {
      "hk0": {
        "removed_fraction": 0.859,
        "floor_before": [17.6, 19.8, 21.2],
        "floor_after": [1.03, 1.98, 1.43],
        "after_floor_max_sigma": 1.79,
        "after_negative_fraction": 0.0124,
        "floor_trend": 0.333,
        "floor_span_fraction": 0.155,
        "floor_judged_q": [2.11, 4.11]
      },
      "h0l": {
        "removed_fraction": 0.9,
        "floor_before": [17, 19.2, 20.5],
        "floor_after": [0.44, 1.32, 0.721],
        "after_floor_max_sigma": 2.74,
        "after_negative_fraction": 0.056,
        "floor_trend": 0.103,
        "floor_span_fraction": 0.167,
        "floor_judged_q": [2.11, 4.11]
      },
      "0kl": {
        "removed_fraction": 0.9,
        "floor_before": [17, 19.1, 20.5],
        "floor_after": [0.427, 1.33, 0.717],
        "after_floor_max_sigma": 2.78,
        "after_negative_fraction": 0.0544,
        "floor_trend": 0.224,
        "floor_span_fraction": 0.17,
        "floor_judged_q": [2.11, 4.11]
      }
    },
    "goal": "Bring the per-|Q|-shell floor to about 0 and level across |Q| (floor_after near 0 in all thirds) without over-subtracting (floors well below 0), and leave no pedestal: max_floor_trend (|rank correlation| of the floors with |Q|, over the outer half of the shells the counts reach) well below 1 and max_floor_span_fraction well below 1 (pedestal_left false). after_floor_max_sigma is the floors in the cut's own σ, which the diffuse sets: it reads above 1 on sound flattens and is no goal by itself. A trend near 1 with a span near 1 or more is a background the model missed, however small it reads in σ."
  },
  "measured_on": ["H–K plane at L = 0", "H–L plane at K = 0", "K–L plane at H = 0"]
}
```

## update_settings {"changes":{"flattenQ2":true}}

No skill read: arm B's gate refuses it until reduction-qc is read (4-tool-results.md); arm C has none.

```json
{
  "changed": [
    {
      "setting": "flattenQ2",
      "from": false,
      "to": true
    }
  ],
  "rerun_from": "flatten"
}
```

## tune_pipeline {"stages":["punch"],"trials_per_stage":2} (a stubbed tuning run of 5.2 min, no skill read)

No skill read: it runs, and passes the switch on to the tuning prompts.

```json
{
  "minutes": 5.2,
  "stages": [
    {
      "stage": "punch",
      "status": "done",
      "tuned": true,
      "chosen_trial": 2,
      "of": 2,
      "changes": {
        "punchMinSig": 4
      },
      "result": "0 missed at nodes · 0 sharp off-lattice · 2 broad maxima kept · punched 0.033",
      "trials": [
        {
          "n": 1,
          "changes": {},
          "result": "1 missed at nodes · 0 sharp off-lattice · 2 broad maxima kept · punched 0.031"
        },
        {
          "n": 2,
          "changes": {
            "punchMinSig": 4
          },
          "result": "0 missed at nodes · 0 sharp off-lattice · 2 broad maxima kept · punched 0.033"
        }
      ],
      "why": "Trial 2 punched the missed node (1 → 0 at nodes) for 0.002 more punched fraction."
    }
  ],
  "note": "Done. The punch's settings changed; run the pipeline from the punch to write them.",
  "write_outputs_with": {
    "tool": "run_pipeline",
    "from_stage": "punch"
  }
}
```

## read_skill {"name":"reduction-qc"} (called by name: it is not offered)

```text
Error: no tool named read_skill. Available: describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, dpdf_contrast, dpdf_peaks, grain_check, ub_check, radial_profile, line_profile, bragg_peaks, consistency_details, run_log, compare_datasets, configure_settings, update_settings, run_pipeline, tune_pipeline, show_in_viewer
```

## The tuning prompt for the flatten, what to try

`buildProposeMessages({ stage: "flatten", …, skills: false })` with a synthetic trial: the goal and the settings' help with the skills off. The system message is TUNE_SYSTEM (3-tuning-prompts.md).

```text
Stage: Flatten.
Goal: Bring the per-|Q|-shell floor to about 0 and level across |Q| (floor_after near 0 in all thirds) without over-subtracting (floors well below 0), and leave no pedestal: max_floor_trend (|rank correlation| of the floors with |Q|, over the outer half of the shells the counts reach) well below 1 and max_floor_span_fraction well below 1 (pedestal_left false). after_floor_max_sigma is the floors in the cut's own σ, which the diffuse sets: it reads above 1 on sound flattens and is no goal by itself. A trend near 1 with a span near 1 or more is a background the model missed, however small it reads in σ.

Settings you may change (use these names exactly):
- flattenQ2 (true | false; default false): model only: also fit b·Q², the smooth rise of an inelastic background (thermal diffuse; with X-rays also Compton); it varies too slowly to follow pair correlations.
- flattenFitQMax (number in [3, 25]; default 10): model only: end (Å⁻¹) of the |Q| range the model is fitted to (from 0.8).
- flattenEstimator (one of model | floor | snip; default model): Pedestal estimator. model (default): a fitted const (+ c·F(Q)² when a magnetic ion is set) on the per-shell low floors. floor: the floors themselves. snip: a SNIP background.

Current settings: {"flattenQ2":false,"flattenFitQMax":10,"flattenEstimator":"model"}
Settings already chosen for earlier stages: {}
Trials so far (trial 1 = the current settings): [{"trial":1,"settings":{"flattenQ2":false,"flattenFitQMax":10,"flattenEstimator":"model"},"metrics":{"max_floor_trend":0.97,"max_floor_span_fraction":1.2,"pedestal_left":true}}]

Propose up to 2 new settings to try, each different from every trial so far and
each changing as few settings as possible, with a one-sentence reason tied to the metrics.
Reply as {"candidates": [{"changes": {"<setting>": <value>}, "why": "<reason>"}]}.
If the current settings already meet the goal, reply {"candidates": []}.
```
