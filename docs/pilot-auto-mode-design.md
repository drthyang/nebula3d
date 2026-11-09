# NEBULA Pilot: Apply cards, auto mode and live highlights

The design behind THY-65 and THY-66. It is built; the shipped behaviour and
its user guide are in [pilot.md](pilot.md#using-it) and [web.md](web.md),
which take precedence where the two differ.

## Summary

- **Apply cards.** Every proposal becomes a card with Apply, Edit and Dismiss.
  That covers a setting, a sample fact, a run or a tuning trial.
  - **Where the cards come from.** The app builds them from what the tools
    already return: refused calls, `rerun_from`, the punch record's
    `ask_user`, the Laue-class and |Q|-band suggestions, and the tuning
    trials. The model writes nothing new.
  - **What Apply does.** The app makes the change itself, through
    `update_settings`' own checks. On a sample fact, the click creates a
    one-use **click grant** for those exact values. Only a trusted click can
    create one, so the model can't forge it.
  - **The record.** Every decision goes into a log and can be undone.
- **Auto mode.** An app-side controller works through a visible plan:
  preflight, run, check and fix each stage, then the report.
  - **The model's share.** The app runs the checks and the pipeline itself.
    The model is asked only to fix a stage that needs attention and to write
    the report. Each of those is an ordinary Pilot reply with no chat
    history, so a request stays well under today's worst turn, and gemma4 at
    32k can manage it.
  - **Sequencing.** The controller moves on by the computed verdicts and
    never changes a setting itself, but for two accepted exceptions: it puts
    back a fix that made its check worse (question 3), and it applies the
    method settings the pre-run Bragg sensing recommends before its run
    (THY-43, accepted 2026-11-08: `bragg_sense`'s `recommend`, the punch
    footprint and its fit's constraints, through `update_settings`, logged
    as auto mode's with the sensing's line as evidence, undoable). The punch's
    row judges those against the defaults when its check needs attention and
    puts them back if they made it worse. A symmetry the sensing finds still
    pauses for your click.
  - **Pauses and limits.** It pauses at a sample fact with an Apply card. It
    has limits, Stop and Resume, and ends with a report.
- **Highlights.** Each measuring step maps its whole result to overlays on the
  slice views (§3.2).
  - A "Now examining" bar names the step, links to it in the chat and holds
    the legend.
  - A **Highlights** switch turns them off.
  - Overlays read results already in memory, so they cost no tokens and work
    the same in both engines.
- **Tokens.** The measured worst turn doesn't change, and its 7 spare tokens
  stay. The model sees only a short "since the last reply" line after a
  decision, and the auto phase prompts, which replace the question. Both get
  new budget cases (§4).
- **Safety.** THY-18, the answer checks, the ring gate, the skill gate and the
  sample-fact guard apply unchanged to every model call. The one new way in,
  the click grant, can't be reached by the model (§5).
- **Build.** Seven PRs (§7). Questions for you are in §8.

## 1. Apply cards

### 1.1 Where proposals come from

The app builds each card from a step's arguments and its full result
(`found(step)`). The model writes no prose for it.

| Source (returned today) | Card | Values from | Evidence shown |
| --- | --- | --- | --- |
| `update_settings` refused: a sample fact, `edgeTrim`, a `symmetry*` setting, a ring change the ring gate held | Sample fact / Setting held | the call's own `changes`, exactly | the turn's steps that settle the topic (`facts.settles`) |
| `update_settings` named a user-only key it can't set (`flattenIon`, `pdfQMin/Max`) | Sample fact | the call's arguments | as above |
| `update_settings` succeeded with `rerun_from`, and no run followed | Run from *stage* | `rerun_from` | the change |
| `off_lattice_bunching` (`run_pipeline`, `assess_stage punch`) | Modulation (fact) | the punch record's bunching: k, order 1, form points | its `facts` line |
| `compare_laue_classes.suggestion` | Laue class (yours) | `suggestion` | `classes`, `flag` |
| `qmax_coverage.suggested_band` when `band_check` flags | \|Q\| band (yours) | `suggested_band` | `raw_counts` edges |
| `regrid_refined_ub` refused, or `ub_check` verdict *attention* | Regrid onto the refined UB | none | `orientation_change_deg`, `rms` |
| The answer names a catalog key with a value ("punchMinSig 6") that no call set | Setting, marked "suggested in the answer" | parsed, then checked by the catalog's `write()` | none |
| `tune_pipeline` trials | Apply on each trial row | `trial.settings` | the trial's headline |

In the trigger example, the Pilot calls `update_settings {punchSupercellH: 2,
modulation: …}` and both are refused. Two fact cards then show the model's
values and the punch check's numbers. Applying either one sets it, with no
retyping (mockup `#cards`).

The answer parser reads only exact catalog keys, which the core prompt already
tells the model to use. Anything that doesn't parse, or fails `write()`, gets no
card.

### 1.2 Data model

```ts
interface Proposal {
  id: string;                                  // "P3"
  kind: "setting" | "fact" | "run" | "trial" | "regrid";
  change: Record<string, ParamValue>;          // as the model named it
  fields: Partial<PipelineConfig>;             // canonical, from the catalog's write()
  from: Partial<PipelineConfig>;               // the values when the card was made
  runFrom?: TuneStage;
  source: { turn: number; step?: string; via: "refused" | "rerun" | "ask_user" | "suggestion" | "answer" | "trial" };
  evidence: { step: string; ref: string }[];   // tool.field paths into found(step)
  dataset: string;
  status: "open" | "applied" | "dismissed" | "undone" | "stale";
}
interface Decision { proposal: string; action: "apply" | "edit-apply" | "dismiss" | "undo"; by: "you" | "auto"; at: number; before: Partial<PipelineConfig>; after: Partial<PipelineConfig> }
```

A card goes **stale**, and can't be applied, once the values no longer match
`from` or the dataset changes.

### 1.3 The click grant (sample facts)

Today a fact changes only when the user's latest message names it
(`namesSampleFact`). Apply adds one more way, which the model can't reach.

- **Only a click creates it.** `llm/consent.ts` creates `{id, key, fields,
  dataset, card}` in the card's click or key handler, and only when
  `event.isTrusted`.
  - The grant lives in module scope only. It is never put in a message, a
    session file or storage.
  - It is used up by the apply it was made for.
- **It travels on a context the model never builds.** Apply runs
  `update_settings`' own `run()` with `AppCallContext = ToolContext & {grant}`.
  `round.ts` builds every model call's context from a `History` that holds no
  grant, and a test pins that.
  - The two fields the model has no setting for, the |Q| band and the magnetic
    ion, are written through the same checked patch.
- **It matches exact values only.** The guard becomes `isSampleFact(key) &&
  !namesSampleFact(msg, key) && !grantCovers(ctx.grant, key, fields)`, which
  compares the canonical fields from `write()`.
  - A grant for `punchSupercellH = 2` doesn't allow 3.
  - The same lift covers `edgeTrim`, and the symmetry settings the model can
    never set.
  - Edit creates a grant for the edited values.
- **Ring gate.** A ring change the gate held gets an "Apply anyway" card,
  marked "No 3D verdict of a ring left yet", and its main action is "Check
  rings in 3D". "Apply anyway" counts as you naming the setting, which the gate
  allows today. Auto mode never pauses for these; it logs them as held.

The model controls only tool arguments (JSON, checked by the schema;
`update_settings` reads only `changes`) and its own text (the guard reads only
the text you typed). So it has no channel to a grant.

### 1.4 What the model is told

The context block, which is rebuilt for every request, gets one line when
decisions were made since the last reply. For example: `- since the last
reply, you applied punchSupercellH 1 → 2 and dismissed modulation`. It sits in
the first user message, not the latest, so the guard's `userMessage` doesn't
change. Its numbers are your own values, which are valid sources.

### 1.5 Undo and the record

- **Undo** puts back `before` for exactly the decision's fields, while they
  still hold `after`. Otherwise it shows "Changed since: undo on Configure".
- **Runs** can't be undone, because they wrote the outputs. Undoing the
  settings change behind a run marks the outputs out of date and adds a "Run
  from *stage*" card. Tuned outputs live in their own folder, so Apply on a
  trial changes the Configure settings only.
- **The log.** A **Changes** list above the chat, built like `MarksList`. It is
  saved with the transcript and in session files. The Report gets a Decisions
  section, and Configure lights the changed fields, as `noteAgentEdit` does.

### 1.6 Layout

- **Where.** The cards go under the answer, grouped as "Proposed changes (n)".
- **One card.** One line with the result first ("Supercell along L: 1 → 2"),
  a kind chip, one evidence line in the tool's own numbers linked to its
  step, and "?" for the rest.
  - Fact cards add one line: "Apply counts as you stating this value".
  - The buttons are Apply · Edit · Dismiss.
- **After a decision.** The card shrinks to "✓ … applied by you · Undo".
- **At 390 px.** The buttons share one row.

## 2. Auto mode

### 2.1 What drives it

**An app-side controller, with the model only for decisions (chosen).** Each
request stays bounded, the plan is fixed and visible, you can stop and resume
at any step boundary, the run moves on by computed verdicts, and every change
still goes through the model's gated calls. The controller calls
`run_pipeline` and the checks itself. When the model picks tuning,
`tune_pipeline` keeps its own loop.

**Rejected:**

- **The agent loop with an auto flag.** One reply would grow past 32k on
  gemma4, there would be no plan to show, you could stop only mid-reply, and
  the model would decide when it's done.
- **A tuner-like controller where the model only proposes values.** No
  reasoning about the checks, and no checked answer.

### 2.2 The plan

| Phase | Who | Tools | Ends when | May pause for |
| --- | --- | --- | --- | --- |
| Preflight | app | `qmax_coverage`, `ring_survey` (THY-43: the raw volume's rings, nothing removed), `ub_check`, `grain_check`, `compare_laue_classes` (raw, unsymmetrised only) | done | Laue class (before Run), \|Q\| band (before the ΔPDF), regrid (optional, never blocks) |
| Run | app | `run_pipeline` for missing or stale outputs | the run ends | none |
| *Stage* check (×5) | app | `assess_stage` *stage* (+ `texture_check` for backfill; `symmetry_check` and `qmax_coverage` for the ΔPDF) | pass or attention | modulation (`off_lattice_bunching`) |
| *Stage* fix (on attention, ≤ 2) | **model** | the stage's skill, then `update_settings` or `tune_pipeline`; then the app runs from `rerun_from` and checks again | the check passes, or 2 tries | any fact it proposes (refused → card) |
| Report | **model** | the final checks, seeded as for "Assess the run" | the answer passes its checks | none |

The Report is `report/collect.ts`'s, as today: a fresh pass with the tools,
figures, settings and the tuning record. Auto mode adds the plan with each
outcome, the decision log, the facts asked and answered, any limit hit, and the
tokens and time.

### 2.3 A model reply in auto mode

- **What it holds.**
  - The system prompt.
  - The tools offered for the phase's topic (`localTools` scoping).
  - The dataset summary.
  - A digest of the run so far. It has no numbers except your own values:
    "Auto run: rings passed; punch needs attention (fix 1 of 2); you set
    punchSupercellH 2."
  - A fixed phase prompt, starting with an action verb so the local offer
    includes the acting tools: "Change or tune the Bragg punch so its check
    above passes: one update_settings change, or tune_pipeline for this
    stage. Say what you changed and why."
  - No chat history.
- **Seeded checks.** The phase's check steps become this reply's first steps,
  and the model reads them as a tool round. They are real results, so the
  answer checks, `{{tool.field}}` and the ring gate all read them.
  - This saves local models the first choice they get wrong: gemma4 used to
    answer from the opening cut.
  - Some transports may refuse a tool round the model didn't call (Claude,
    with its thinking replayed). There the results go in the phase message,
    and the steps are registered the same way. PR6 checks each transport with
    a test.
- **The same guards.**
  - `userMessage` is `""`, so no fact is named, and facts change only by
    grant.
  - `earlierSteps` carries the run's earlier steps. A 3D ring verdict from the
    check then opens the ring gate for the fix, and runs make evidence stale as
    they do today.
  - The fix reply reads its stage's skill.

### 2.4 Pausing at a fact

The controller finishes the current tool step, then pauses before the first
phase the fact changes:

- a Laue class before Run;
- a supercell or modulation before the punch fix;
- a band before the ΔPDF check.

Until then it goes on with phases that don't depend on the fact.

While paused, the plan row says "Needs you". The card is pinned in the Auto
panel, and the views light the evidence behind it (mockup `#paused`). The
clock stops.

- **Apply:** the app creates a grant and makes the change, then runs from the
  fact's stage and checks again.
- **Skip:** the fact is recorded as declined and the run goes on. The report
  lists it as an open question.

### 2.5 Limits, stop, resume, failures

- **Limits.**
  - Rounds per reply: 6 for a fix and 4 for the report, under
    `MAX_TOOL_ROUNDS` (12).
  - 2 fixes per stage, and 12 model replies per run.
  - 30 minutes of wall clock (adjustable from 10 to 60), not counting the time
    spent waiting for you.
  - A token cap for cloud models.

  When a limit is hit, the step in progress finishes and the run goes to the
  Report, which names the limit.
- **Stop** aborts the request and the pipeline job (`run_pipeline` already
  cancels on abort) and marks the step stopped. The plan, the steps and the
  decisions are saved to sessionStorage and session files.
- **Resume** restarts the phase that was stopped. If a fix's change was
  already applied, the app first runs from its stage.
- **Failures.**
  - **The model server fails after `recovery.ts`'s retries:** the run pauses
    with Retry or Stop.
  - **A pipeline run fails:** the run pauses and links the log.
  - **A tool error:** the reply reads it, as today.
  - **An answer kept with ⚠ marks:** the run goes on, because the controller
    reads tool outcomes, and the report shows the ⚠.
  - **A fix makes a check worse:** the controller puts back the settings from
    before the fix and logs it (question 3).
- **Undo auto changes:** one action that restores the settings snapshot taken
  at the start, then offers a run.

### 2.6 Layout

- **Starting.** A "Run auto analysis" chip leads the one-click requests.
- **While it runs.**
  - The other chips give way to "Stop auto analysis", and the composer is
    disabled.
  - An **Auto panel** sits above the chat. It holds the title, the state, the
    clock against the limit, and Stop; a thin progress bar; and the plan.
  - The plan is in the NeXus Viewer's *Processing* list style: a status dot,
    the name, and the state right-aligned in mono.
- **On a phone.** The panel folds to one line ("Auto · Bragg punch · fix 1 of
  2 · 6:12 ▾") that opens into the plan.

## 3. Highlights

### 3.1 Flow

1. **A step starts.** The bar reads "Now examining *label*", and the view it
   reads gets a thin outline.
2. **The step finishes.** Its overlays are drawn from `found(step)`, and Follow
   moves the console as today (`openView`).
3. **The next step finishes.** Its overlays replace them.
4. **After the reply.** The last set stays until a run recomputes the stage it
   measured, or you clear it. The step's Show button draws it again.

### 3.2 Tool → overlay

| Tool (fields read) | Views | Overlay |
| --- | --- | --- |
| `assess_stage punch` (`per_plane.*.strongest_leftover`), `measure_reciprocal_cut` (`bragg_punch.leftover.suspicious_peaks`: hkl, `at_node`, `broad`, `on_protected_plane`) | punched; raw dashed | nodes of the punch cell (dots). Leftovers: at a node, red ring; sharp off-lattice, amber diamond; broad, cyan dashed; protected, grey. Punch holes outlined from the slice's own NaN voxels. Round-2 voxels in `--r2` magenta (exists today) |
| `bragg_peaks` (hkl, q, significance, `resolution_limited`, `measured_width_q`) | Bragg page, raw | fitted footprints (`punchGeometry` ellipses): solid if resolution-limited, dashed if broadened; the top 8 labelled |
| `assess_stage rings` (`shells_judged`: at, ring, isotropy, `not_judged`; `stage_shells`), ring diagnostics (`unconfirmed_at_grid.q_centers`) | raw, ring-removed | \|Q\| shells (`qShellEllipseForPlane`) by code: **AL** removed on an Al line, green dashed; **LEFT** a ring left, red with ticks; **GRID** not confirmable on this grid, amber dotted; **XTAL** the crystal's own, grey dashed; **NJ** not judged, white dotted |
| `measure_reciprocal_cut` `ring_residuals` (`significant`) | that cut | a tick on the shell: ▲ left, ▼ dent |
| `assess_stage flatten` (`floor_judged_q`, `pedestal_left`), `radial_profile` | flattened, backfilled | the judged \|Q\| band shaded; an amber annulus when a pedestal is left; the shell floors as a sparkline in the legend |
| `texture_check`, `assess_stage backfill` (holes: `centre_hkl`, `bias_sigma`) | backfilled | holes filled outside their rim's range: ▲ above, ▼ below |
| `grain_check` (`far`, `rotated_copy`) | raw | off-lattice orbits ✕; the rotated copy's nodes in teal |
| `dpdf_peaks` (`features`: `vectors_A`, sign of `size_sigma`) | ΔPDF sections | candidates: + red / − blue rings sized by σ, labelled in Å; drawn on a section only within half a voxel of it |
| `qmax_coverage` (`raw_counts` edges, `fully_measured`, `transform_reach_q`, `suggested_band`) | raw | coverage edges as dashed circles; unmeasured space hatched (the NeXus Viewer's no-data hatch); the transform's reach in amber; the suggested band |
| `ub_check` (`orientation_change_deg`, `axis_uvw`), the punch record's misorientation | raw, Bragg page | arrows at strong peaks along ω × q, scaled up, with the factor in the legend |
| `line_profile` | its stage | the line in a dashed band (the NeXus Viewer's cut) |
| `mark_region`, `show_in_viewer` | as today | unchanged; marks are drawn above the overlays |
| `symmetry_check`, `compare_laue_classes`, `run_log`, … | none | the bar only |

The mappers live in a registry, `llm/examine/overlays.ts`. A test holds every
measuring tool (`facts.measures`) to a mapper or an explicit "none".

### 3.3 The bar, legend, follow and switches

- **"Now examining" bar.** One line between the workspace header and the views:
  "● Now examining · Bragg punch · leftover peaks on 0kl, H = 0 · step 2 ↗".
  - "step 2" scrolls the chat to that step and pulses it. The step row carries
    a swatch.
  - On a phone the bar sticks to the top of the views.
- **Legend.** Chips in the bar, one per class present, with counts. Each chip
  turns its class on or off, and "?" explains the codes. In the Focus and
  Single layouts the legend also sits inside the large view.
- **Linked cards.** Hovering a card's evidence lights its points and dims the
  rest (mockup `#paused`).
- **Follow.** Unchanged. With Follow off, overlays draw where you are, and the
  bar offers "Go there".
- **Highlights switch.** A chip beside Tools, Follow and Vision. Off hides the
  overlays but keeps the bar.

**Colours.** The overlays use the semantic tokens (`--red`, `--amber`,
`--green`), with shape and dash as a second cue and a dark halo, as
`RegionMarks` draws them. Marks keep their per-colormap colour, round 2 keeps
`--r2`, and the unit-cell lines stay white or black.

### 3.4 Performance and the two engines

- **No new data.** Overlays read only tool results already in memory, and the
  slice the view already holds (for the NaN outline). Nothing is fetched and
  no endpoint is added, so native and Pyodide behave the same.
- **Drawing is capped.** At most 400 primitives per view; peaks are culled to
  the viewport (`visibleNodes`); labels only for the top 8.
- **Hole outlines are cheap.** Marching squares on the shown slice only, a few
  ms at 401², cached per slice.
- **Pan and zoom only re-project.** All of it is one SVG layer, as
  `RegionMarks` uses. Each set records the version of the outputs it measured,
  and is dropped when they change.

## 4. Token impact

| Change | Model-visible | Cost | Offset |
| --- | --- | --- | --- |
| Cards, log, Undo, grant, highlights | no | 0 | none |
| "Since the last reply" line (§1.4) | in the turn after a decision only | about 8 tokens per decision; 0 on the budget turn | a new budget case (3 decisions), held to the worst turn |
| Auto check and run phases | no model | 0 | none |
| Auto fix reply | in place of the question | estimate: 1.4k system + 2.7k tools + 0.3k context + 2.4k skill core + 3k results ≈ 9.8k + 6.1k reserve ≈ **16k** | a new case "auto: worst fix", held to the 20 % target (26,214) |
| Auto report reply (every check seeded, no skill) | in place of the question | estimate: 1.4k + 5.6k + 0.3k + 8.1k ≈ 15.4k + 6.1k ≈ **21.5k** | a new case "auto: report", held the same way |

The system prompt (1 token under its ceiling), the tool descriptions, the
results and the skills stay as they are, and so do the 7 spare tokens. The
phase prompts get their own model-visible snapshot. Like other model-visible
changes they wait for THY-52.

## 5. Safety

| Rule | How it holds |
| --- | --- |
| THY-18 | The card evidence and the overlays are the tools' numbers, drawn by the app. The controller moves on by `verdicts/` outcomes. Each auto reply's answer is checked, and `{{achieved}}` is computed. |
| Answer checks (`uncalledSources`, `unasked`, marks, staleness) | They run unchanged on each reply. Seeded steps count as called, because they ran in that reply. An `ask_user` question is still asked in the answer, and also shown as a card. |
| Ring gate | Unchanged for model calls. Auto replies carry the run's steps, so the gate sees the 3D verdict. The controller never changes a ring setting. |
| Sample-fact guard | Unchanged for model calls. Auto replies name no fact. Only a trusted click's grant for the exact values lifts it, and a grant is never saved or sent. |
| Skill gate, evals | Unchanged. The fix reply reads its skill, and the harness stubs the controller's runs. |

**Risks:**

- **Seeded checks differ from what a model would call.** Compare arm B-auto
  with arm B.
- **The answer parser misreads a card.** A corpus test with negatives covers
  it, and no card applies anything until you click it.
- **Clutter at 390 px.** Overlays go on the main view only, the legend shows as
  chips, and the switch turns them off.
- **Loops.** The limits stop them.
- **A grant comes back with a restored session.** It can't: grants are never
  saved.

## 6. Test plan

- **Unit** (vitest, synthetic):
  - **Proposals:** each source to its card, and a parser corpus.
  - **Consent:**
    - a grant comes only from a trusted event and is used once;
    - it needs an exact canonical match;
    - no model-path context carries one (driven through `runRound`);
    - a restored session carries none.
  - **The `update_settings` guard with a grant.**
  - **Undo.**
  - **The controller** (a scripted model on `syntheticCrystal`):
    - it moves on by outcome;
    - it pauses at a fact, then goes on after Apply or Skip;
    - every limit holds (fake clock);
    - Stop and Resume work in every phase;
    - a failure pauses it;
    - a worse fix is put back;
    - it makes no `update_settings` or `tune_pipeline` call of its own.
  - **Overlays:** a mapper, or an explicit none, for each measuring tool;
    each mapper's output; the caps.
  - **Budget:** the three new budget cases; the phase prompts in the
    model-visible snapshots.
- **Replay:**
  - a full auto run on the recorded fixtures, with a supercell refusal, its
    card, Apply and the resume;
  - `thy18.replay` extended to auto replies;
  - Playwright on the synthetic demo, both engines, 1440×900 and 390×844.
- **Free local eval** (under 30 minutes): a validation arm **B-auto** (the task
  through the controller), on the quick preset: gemma4:26b, the 8 dev cases,
  one run each, about 15 to 20 minutes. The harness skips fact cards. It
  passes when all of these hold:
  - it scores at least the 2026-11-02 quick arm-B record;
  - no fact changes without a grant;
  - no ring changes without a 3D verdict;
  - every answer passes its checks, or is kept with its ⚠ marks.

## 7. Build steps (one PR each)

| # | PR | Model-visible | Agent |
| --- | --- | --- | --- |
| 1 | **Cards, UI only.** The proposal builder, the card, Apply for settings, runs and trials through today's paths, Dismiss, the log, Undo, the Changes list, and the Report section | none | builder-high |
| 2 | **Grant and fact cards.** `consent.ts`, the guard's grant lift, fact Apply and Edit, and the band and Laue writes | none (refusals unchanged) | builder-xhigh (safety) |
| 3 | **The "since the last reply" line,** with its budget case | yes: waits for THY-52 | builder-high |
| 4 | **Highlights v1.** The overlay store and registry; punch, rings, coverage and flatten; the bar, legend and switch; desktop and phone; both engines | none | builder-high |
| 5 | **Highlights v2.** Bragg-page peaks, ΔPDF candidates, the UB turn, texture holes, grains | none | builder-high |
| 6 | **The auto controller.** Phases, seeding, limits, stop and resume, fact pauses, the report; scripted and replay tests; the budget cases | yes (phase prompts): waits for THY-52 | builder-xhigh |
| 7 | **Auto UI and the eval.** The panel, plan, progress, the phone bar, and the free B-auto quick eval | none | builder-high |

PRs 1, 2, 4 and 5 can ship before the freeze ends. PRs 3, 6 and 7 wait for it.

## 8. Questions for you

1. **Facts up front?** Should auto mode first show the five facts (supercell,
   modulation, Laue class, |Q| band, magnetic ion) for one confirmation, so it
   pauses less? Or ask only when evidence calls for one? *Default: only on
   evidence.*
2. **A sandbox for auto runs?** Should auto mode run into its own folder, like
   tuning, and leave `processed/` untouched until you choose Keep? That makes
   Undo complete, but it needs the tuning-run backend to do full runs in both
   engines. *Default for v1: `processed/`, like `run_pipeline`, with a settings
   snapshot to put back.*
3. **Put back a worse fix?** May the controller put back the previous settings
   on its own when a fix makes a check worse? It would be logged and undoable.
   *Default: yes.*
4. **Cards from the answer text?** Should settings named only in the prose get
   cards? That catches suggestions made without a call, at a small risk of
   misreading one. *Default: yes, marked "suggested in the answer".*
5. **Ring codes?** Derive AL / LEFT / GRID / XTAL / NJ from today's fields, or
   have the ring stage write a code per shell? The second is a backend change
   in both engines. *Default: derive them in v1.*
6. **When to pause for a fact?** Right away, or at the first phase the fact
   changes? *Default: at that phase, so more gets done while you're away.*
7. **Limits?** Are 30 minutes, 2 fixes per stage and 12 model replies right?
   Do you want a cost cap for Claude?
8. **One "Apply and run" button?** In manual mode, should a fact card offer
   "Apply and run from punch" as one button? *Default: Apply, then a Run card.
   Auto mode runs by itself.*
