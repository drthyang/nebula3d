# NEBULA Pilot context: measured, and a leaner design

**Status:** proposal, 2026-11-01. Design only: no prompt, tool, skill or loop
setting is changed by this document or its branch. Every number below comes from
`scripts/measure_pilot_context.sh` (the token-budget test's harness and
estimator) or from a local tokenizer run (`--real`, Ollama on this Mac), unless
it is marked *estimate*.

**The ask.** The user: "About the agent context, we have to optimize it. I think
concise is better. Can you carefully design and make it more efficient for
agents?" The 32k local budget is full. On main, the 32k guard of
`tokenBudget.test.ts` keeps 54 tokens to spare (LM Studio loaded with 32k, one
skill gated at the cap). A recent change failed it by about 17 tokens. Two of
its ±5 % pins sit at +4.5 % and +4.7 %. Four
queued features add model-visible text: THY-59 (Laue R_int statistics), THY-60
(UB-aware punch), THY-61 (ring doublets) and THY-62 (powder phases).

**Correctness first (THY-18).** No verdict without its evidence, numbers by
reference, and verdicts computed rather than self-graded. Every proposal keeps
all three. Proposals that change what a model can do are flagged **[behaviour]**.

---

## Summary

**What fills the window.** The budget test's worst local turn (arm B, the
validation TASK, two skills and a reference page, eight checks), by component:

| Component | est. tokens (the test's count) | real tokens, gemma4:26b |
| --- | ---: | ---: |
| Skills and reference page | 20,758 | 8,006 |
| Tool results | 9,086 | about 6,010 |
| Tool definitions (25 offered) | 7,161 | about 6,470 |
| System message | 4,453 | 3,839 |
| Opening context and task | 2,382 | 1,619 |
| **Worst request** | **43,841** | **25,943** |
| + reply reserve, against 32,768 | 49,985 (over by 17.2k) | 32,087 (2 % left) |
| Compacted peak + reserve | 40,944 (over by 8.2k) | 28,006 (15 % left) |

**The findings.**
1. **The fixed part dominates every request.** System, tools and opening are
   14.0k est. (11.9k real) before any result. The dev run counted 13.9k a
   request on average.
2. **The estimator counts skill prose 2.5–2.8× too high.** It uses the data
   rate, 1.4 characters a token; real tokenizers read 3.3–4.1. That accounts
   for 12.8k of the "over by 17k".
3. **But the real budget is tight too.** The whole worst turn leaves 2 % of
   32k. Compaction makes room by cutting each skill to its 400-character head.
   No skill has a `## Gates` section, so the method goes too. In the dev runs,
   skills were shortened in 4 of 8 gemma runs, and qwen re-read them.
4. **Most rules are written in three places** (system, tool descriptions,
   skills or verdict criteria). The ones that failed in the dev runs failed
   where they lived far from the number they judge:
   - "UB turned at 0.05°" is in the skill only, and ub_check's result has no
     verdict;
   - "rings on data that should have none are an anomaly" is in the skill
     only.
5. **The opening one-cut context is a liability in tools mode.** No answer
   number came from it. It misled qwen, and before the answer checks it led
   to 12 failed runs with no tool call.

**The design**, in layers:
- L0: a core prompt of about 600 real tokens, with the evidence rules, the
  checklist and who decides what;
- L1: tool contracts of at most 500 characters;
- L2: skill cores with `## Gates` that survive compaction;
- L3: details and references read by section.

Each rule gets one home, preferably the result that judges it. Results become
compact (signed numbers, units once, tables for bulk lists, terse criteria),
and compaction keeps the evidence an answer must cite.

**The top savings**, worst turn:

| Proposal | est. tokens | real, gemma4 | Model-visible |
| --- | ---: | ---: | --- |
| C5 skill cores and references by section | −12.8k whole / −8.2k compacted | −5.1k / −3.4k | skill text (yours) |
| C6 count Markdown at 3.0 characters a token | −11.1k / −7.9k | 0 (counting only) | no |
| C2 core system prompt | −3.0k | −2.6k | yes |
| C3 tool contracts | −2.3k | −2.0k | yes |
| C1 state digest instead of the one-cut context (tools mode) | −1.9k | −1.3k | yes **[behaviour]** |
| C4 compact results (and ub_check's computed verdict) | −2.0k whole | −0.9k | yes |
| C8 detail tools on request (TASK) | −0.9k | −0.8k | yes **[behaviour]**, optional |
| C7 compaction keeps the evidence | 0 at the peak | 0 | no new text |

C5 and C6 overlap on the skills: together −17.1k est. on the whole turn.

- **C1–C5 and C7** take the worst turn to about 27.9k est. tokens with the
  reserve, with every skill whole and no compaction: 15 % headroom. In real
  tokens (gemma4) that is about 20.3k, 38 %.
- **With C6**, 23.7k est.: 28 % headroom, which holds a 2,500-token reserve for
  THY-59 to THY-62 at the 20 % target.

**The rule for new features.**
- 20 % headroom under 32k for the worst local turn.
- Ceilings per component in place of the ±5 % pins.
- Every model-visible PR states its cost from the measurement script.
- New tools are scoped to topics, with descriptions of at most 500 characters.

**The order.**
1. THY-59 first, as built.
2. The redesign in five PRs (R1–R5):
   - THY-60's TS part follows R1's result conventions;
   - THY-61/62 follow R2's contracts and R5's compaction.
3. A free local dev eval (gemma4, muse-glimmer) before and after.
4. The THY-52 re-baseline, with the paid run only on your yes.


---

## 1. How it was measured

- **`scripts/measure_pilot_context.sh [out-dir] [--real]`** runs
  `scripts/pilot_context/measure.spec.ts` through vitest from `web/`. It sits
  outside CI's include patterns. It uses the budget test's own harness: the
  synthetic crystal behind a mocked API, the dev control's recorded
  `dpdf_peaks` list, and a scripted model driven through the real agent loop.
  It also uses the budget test's estimator (`provider/tokens.ts`):
  - prose and tool definitions at 3.5 characters a token;
  - tool results and fenced JSON at 1.4;
  - uncalibrated, as the budget test pins it.

  It reports:
  - the system prompt by section;
  - every tool definition, and the local offer by question type;
  - the opening messages;
  - the skills and their reference pages;
  - a sample of every tool's result (the model-visible snapshots);
  - the send-backs;
  - a reply's requests as they grow, with and without compaction;
  - where each rule is stated;
  - reshapes of the largest results.
- **`--real`** (`scripts/pilot_context/realtokens.mjs`) counts every component
  with the real tokenizers of **gemma4:26b** and **qwen3:32b** (Ollama: each text
  sent raw behind a nonce, and its `prompt_eval_count`), plus three whole
  requests through `/api/chat` with their tools.
  - qwen3:32b stands in for qwen3.8-27b, which LM Studio would have to load
    whole to count. It is the same tokenizer family; treat it as an *estimate*
    for qwen3.8.
- **The dev transcripts** (`docs/evals/validation/ollama-gemma4-26b-dev*`, the
  dropped qwen3.8 runs, the older scenario records in `docs/evals/results/`)
  were read for what the models used, ignored and misused (§3).
- Synthetic data and dev fixtures only. No unpublished volume is read or shown.

---

## 2. What a request carries

### 2.1 The worst turn, by component

The budget test's worst realistic turn is arm B on a local model, with the
validation TASK's tool offer and the method's order of calls:
- skills read: reduction-qc, then delta-pdf-interpretation and its `delta_pdf`
  page;
- checks: the eight the system prompt asks for.

The table also shows a typical gemma4 dev run, re-driven on the synthetic
crystal: one skill, then describe_dataset, assess_stage all, ub_check,
qmax_coverage, two cuts and dpdf_peaks.

| Component | worst turn, whole: est. | real, gemma4 | worst turn, compacted peak: est. | real, gemma4 | typical run, peak: est. |
| --- | ---: | ---: | ---: | ---: | ---: |
| system message | 4,453 | 3,839 | 4,453 | 3,839 | 4,453 |
| tools offered (25 of 28) | 7,161 | about 6,470* | 7,161 | about 6,470* | 7,161 |
| opening (context, acknowledgement, TASK) | 2,382 | 1,619 | 2,382 | 1,619 | 2,382 |
| skills and reference page | 20,758 | 8,006 | 14,736 | about 5,820 | 6,386 |
| tool results | 9,086 | about 6,010* | 6,069 | about 4,110* | 8,339 |
| **prompt** | **43,841** | **25,943** | **34,800** | **21,862** | **28,721** |
| + reply reserve (6,144) | 49,985 | 32,087 | 40,944 | 28,006 | 34,865 |
| against 32,768 | over by 17,217 | 681 left (2 %) | over by 8,176 | 4,762 left (15 %) | over by 2,097 |

\* By subtraction from the whole request, which gemma4 counted through `/api/chat`
with its tools, so the template's own tokens are inside the tools row. The other
real cells are the components' own counts.

- **The estimator over-counts the worst request by 1.7×** (43,841 against gemma4's
  25,943; 1.6× compacted, 1.2× on the opening request). Almost all of the gap is
  the tool results and the skills, counted at 1.4 characters a token (§4.6).
- **qwen3:32b agrees.** It counts the opening request at 11,245, against
  gemma4's 11,924, and every component group within a few per cent of gemma4,
  most a little lower. gemma4's numbers stand for both.
- **In real tokens the worst turn fits 32k only just, and only on gemma.** The
  whole turn leaves 2 % with the reply reserve. The compacted turn leaves 15 %,
  but compaction is what cuts the skills to their 400-character heads (§4.5).
- **LM Studio loaded with 32k:** the guard shortens down to the newest result.
  The largest request sent is 29,857 est. tokens, 2,911 left for the reply. One
  skill gated at the cap would leave 54 past MIN_REPLY: the "full" budget.


### 2.2 The system prompt (4,447 est. tokens in arm B, 3,041 in arm C)

| Section (arm B) | chars | est. tokens |
| --- | ---: | ---: |
| Tools guidance, part 2: the six checks and their routing, symmetry, `dpdf_contrast`, `dpdf_peaks`, `grain_check`, bunching and `ask_user`, `ub_check`, Laue, "Verdicts come from the tools", references | 4,629 | 1,323 |
| Tools guidance, part 1: stale context, another cut, look-ups, Follow, `mark_region`, run and tune | 2,340 | 669 |
| Skills list (names and descriptions) | 1,657 | 473 |
| Glossary: `ring_removal` | 1,436 | 410 |
| Glossary: `bragg_punch` | 1,392 | 398 |
| Glossary: `delta_pdf` | 1,373 | 392 |
| Glossary: `flatten` | 1,280 | 366 |
| Identity and pipeline | 634 | 181 |
| Ground rules | 429 | 123 |
| Glossary: `backfill` | 380 | 109 |

The glossary (5,861 characters, about 1.7k est. tokens) explains the fields of
**one 2D cut**: the opening context and `measure_reciprocal_cut`/`measure_dpdf_cut`.

### 2.3 The tools (7,988 est. tokens for all 28; 7,161 for the TASK's 25)

Descriptions are 67 % of the definitions (18,608 of 27,957 characters). The
largest:

| Tool | description chars | parameters chars | est. tokens |
| --- | ---: | ---: | ---: |
| update_settings | 2,951 | 146 | 917 |
| mark_region | 798 | 831 | 490 |
| ub_check | 1,317 | 138 | 439 |
| qmax_coverage | 1,315 | 33 | 410 |
| texture_check | 1,058 | 225 | 392 |
| compare_laue_classes | 1,170 | 33 | 371 |
| dpdf_peaks | 943 | 249 | 365 |
| tune_pipeline | 723 | 386 | 342 |
| symmetry_check | 937 | 149 | 336 |
| dpdf_contrast | 666 | 338 | 312 |

**The local offer by question** (`localTools.ts`, arm B):

| Question type | tools | est. tokens |
| --- | ---: | ---: |
| validation TASK (matches nearly every topic) | 25 | 7,161 |
| act: "Run the pipeline." | 20 | 5,863 |
| general ("What do you see?") | 17 | 4,341 |
| pdf, coverage | 17 | 4,034 |
| act: "Tune the flatten and rerun." | 15 | 4,072 |
| punch, lattice | 14 | 3,185 |
| rings, backfill, symmetry | 13 | 2,941–2,967 |
| flatten, compare | 12 | 2,463–2,550 |
| one-click stage reviews | 13–18 | 2,941–4,323 |

Scoping already halves the offer for a focused question. The TASK, the one the
validation measures and the budget pins, gets 25 of 28. compare_laue_classes is
not among them, although the system prompt and reduction-qc both tell the model
to run it.

### 2.4 The opening messages

| Message | chars | est. tokens |
| --- | ---: | ---: |
| Context block (one cut's metrics, JSON indented 1) | 3,103 | 2,188 |
| ↳ the same, compact JSON | 2,373 | 1,666 |
| Acknowledgement | 122 | 40 |
| Validation TASK | 522 | 154 |

- **Per reply:** the context block is re-sent once per request, every request.
- **Earlier turns:** they go as their text only, the newest 8 messages
  (`CHAT_HISTORY_TURNS`). Their tool results are not carried. At the gemma4
  dev run's mean answer length (2,645 characters), 4 earlier exchanges cost
  about 3.1k est. tokens; at the longest (4,787), 5.6k.
- **Nothing else is injected per round.** Run state, facts and highlights never
  reach the model. Within a reply, the only messages added besides tool calls
  and results are:
  - the send-back (§2.7);
  - the "answer now" note (about 35 est. tokens).

### 2.5 The skills

| Read with read_skill | chars | est. tokens as counted (1.4) | at the prose rate (3.5) | shortened stub |
| --- | ---: | ---: | ---: | ---: |
| reduction-qc | 8,899 | 6,356 | 2,543 | 468 chars |
| delta-pdf-interpretation | 7,389 | 5,278 | 2,111 | 468 chars |
| bragg-node-audit | 5,976 | 4,269 | 1,707 | 468 chars |
| › delta_pdf page (cut at 12,000) | 12,602 | 9,001 | 3,601 | — |
| › bragg_cleanup page | 12,397 | 8,855 | 3,542 | — |
| › ub_refinement page | 7,331 | 5,236 | 2,095 | — |

**No skill has a `## Gates` section.** Compaction therefore cuts a skill to its
first 400 characters: the title, the "Draft" status and the introduction, with
no step, threshold or rule.

### 2.6 Tool results (samples as sent)

| Result (synthetic crystal) | chars | est. tokens | prose (strings > 60 chars) |
| --- | ---: | ---: | ---: |
| assess_stage all | 3,277 | 2,341 | 42 % (five `criterion` texts: 1,222 chars) |
| dpdf_peaks, dev control, 12 entries | 3,096 | 2,211 | `reading` boilerplate, 345 chars |
| assess_stage punch | 3,087 | 2,205 | 59 % |
| compare_laue_classes (demo) | 2,467 | 1,762 | 45 % |
| radial_profile | 2,096 | 1,497 | 0 (repeated row keys) |
| bragg_peaks | 2,071 | 1,479 | 0 (repeated row keys) |
| assess_stage flatten | 2,044 | 1,460 | 48 % |
| configure_settings | 1,570 | 1,121 | 0 (54 settings; never cited) |
| measure_reciprocal_cut | 1,487 | 1,062 | 0 |
| qmax_coverage | 1,270 | 907 | 59 % (the same edges stated three times) |
| ub_check | 956 | 683 | 12 % |
| everything else | < 900 each | | |

### 2.7 Send-backs

A send-back is 55–199 est. tokens (`5-answer-checks*.md`). The rejected draft
stays in the conversation for the rewrite: one answer's length, about 750–1,400
est. tokens at the dev run's answer lengths. This is small and needed; it is
left as it is.

### 2.8 Growth over a run, and compaction

The budget test's method order, arm B, local, estimator tokens:

| Request | after | whole | compacted |
| ---: | --- | ---: | ---: |
| 1 | (opening) | 13,996 | 13,996 |
| 2 | read_skill reduction-qc | 20,382 | 20,382 |
| 3 | assess_stage all | 22,747 | 22,747 |
| 4 | qmax_coverage | 23,669 | 23,669 |
| 5 | symmetry_check | 24,151 | **18,129** (past 24k: all but the newest 3 shortened; reduction-qc becomes its 400-character head) |
| 6 | texture_check | 24,430 | 18,408 |
| 7 | ub_check | 25,127 | 19,105 |
| 8 | grain_check | 25,730 | 19,708 |
| 9 | radial_profile | 27,243 | 21,220 |
| 10 | read_skill delta-pdf-interpretation | 32,558 | 25,065 |
| 11 | read_skill › delta_pdf page | 41,615 | 33,947 |
| 12 | dpdf_peaks | 43,841 | 34,800 |

- **The fixed part is 14k of 44k.** System, tools and opening are 13,996 est.
  tokens (11,924 real, gemma4) on every request, before any result.
- **Per round:** the results grow by 300–2,300 est. tokens each, and the skills
  by 5,000–9,000 a read.
- **The typical gemma4 dev order** (one skill, eight calls, no rerun) peaks at
  28,721 whole and 23,797 compacted. Its mean request is 23,066 est. tokens.
  The dev run's server counts were 13.9k a request on average over 76
  requests (12.0–15.1k per run): the same ratio of about 0.6 to the estimate
  as the worst request's.


### 2.9 The biggest consumers

Worst turn, whole, by share:

| Consumer | est. tokens (share) | real, gemma4 (share) | Main waste |
| --- | ---: | ---: | --- |
| Skills and the reference page | 20,758 (47 %) | 8,006 (31 %) | read whole; counted at the data rate; no gates kept through compaction |
| Tool definitions (25) | 7,161 (16 %) | about 6,470 (25 %) | algorithm prose in descriptions; update_settings' catalogue; detail tools never called |
| Tool results | 9,086 (21 %) | about 6,010 (23 %) | criteria explained every call, boilerplate, row keys repeated |
| System message | 4,453 (10 %) | 3,839 (15 %) | a glossary for one cut; routing that restates the tools |
| Opening context | 2,382 (5 %) | 1,619 (6 %) | one stale cut, indented JSON |

The largest single items (real, gemma4):

| Item | real tokens |
| --- | ---: |
| delta_pdf reference page | 3,820 |
| reduction-qc | 2,303 |
| delta-pdf-interpretation | 1,883 |
| context block | 1,477 |
| the TOOLS checks paragraph | 1,160 |
| assess_stage all | 1,132 |
| radial_profile | 1,036 |
| update_settings' description | 789 |


---

## 3. What the models used (dev transcripts)

From the gemma4:26b dev run (8 cases, arm B, the frozen commit), the dropped
qwen3.8-27b runs and the older scenario evals:

- **Skills.**
  - gemma read reduction-qc in 7 of 8 runs. It read each of the other two in
    2 runs, and never a reference page. It planned all three in 6 runs.
  - **Read but not applied:**
    - dev-ub read reduction-qc's "turned at 0.05° or more", then called 0.601°
      "a small rotation… the orientation is correct".
    - dev-rings read "rings on data that should have none are an anomaly",
      then reported "No problems".
  - The acceptance checklist was met in 0 of 7 answers.
  - **Compaction hurt.** gemma's skills were shortened in 4 runs, to the
    400-character head. qwen noticed and re-read: "Let me get the full
    reduction-qc skill (it was shortened)". qwen also re-called shortened
    `dpdf_peaks` and `radial_profile`.
- **The opening context.**
  - gemma read it in every first step, mostly for its `notes` ("no ΔPDF slice
    available"). **Not one of 182 numbers in the answers came from it.**
  - It misled qwen on the ring-free control, which chased its `significant`
    ring residuals with radial_profile ×6.
  - **In the older scenario evals, answering from the context alone was fatal:**
    gemma and qwen3:32b each made 0 tool calls in 6 of 27 runs, and all 12
    failed.
  - The system prompt's "base every statement on numbers in the context" pulls
    against the tools paragraph's "compare … with your own earlier tool
    results, not with the context".
- **Tools.**
  - gemma made 6–12 calls a run and stopped with 3–6 rounds unused in 7 of
    8 runs.
  - It never called 11 of the 24 tools offered: current_view, dpdf_contrast,
    grain_check, radial_profile, line_profile, bragg_peaks,
    consistency_details, run_log, run_verdict, tune_pipeline, show_in_viewer.
  - One run (dev-flatten) called assess_stage per stage. It hit 12 rounds
    before re-measuring its fix, and its answer was empty.
- **Cited fields.**
  - Of gemma's 182 numbers:
    - 110 came from dpdf_peaks (vectors_rlu, vectors_A, length_A, size_sigma);
    - 27 from assess_stage (mostly `headline`; `criterion` 2);
    - 23 from measure_reciprocal_cut.
  - Never cited, summed over the run:
    - configure_settings' settings, 7.5k characters;
    - assess_stage's criterion and goal texts, about 10k;
    - `dpdf_peaks.reading`, 4.7k;
    - qmax_coverage's settings and band_check, 2.5k.
  - Uncited is not unused: `ub_check.reading` drove the only fault gemma found
    (dev-origin).
- **Send-backs.**
  - One confirmed (dev-control). Its missing-evidence issue was fixed by
    calling qmax_coverage.
  - Its "−1520 and −579 appear in no tool result" was **not** fixed:
    dpdf_peaks gives the sign in a separate field (`"sign": "−"`,
    `size_sigma: 1520`), so the model's signed number is untraceable.
  - The model also read the send-back as the user's words.
- **References.**
  - `{{tool.field}}` was used about once, as
    `{{symmetry_check.ops[0].rms_difference}}`. The reference grammar takes no
    brackets, and the system prompt never shows how to index a list.
  - Answers mostly quoted raw numbers instead.
- **Rules that failed, by where they live:**
  - "UB turned at 0.05°" lives only in the skill. ub_check's result carries no
    verdict, and the model contradicted the computed one.
  - "never grade a stage yourself; quote {{achieved}}" lives in the prompt; 0
    of 7 answers quoted {{achieved}}.
- **Real token counts (server-counted).**
  - gemma: 13.9k per request on average (12.0–15.1k per run, 76 requests).
    Ollama loaded num_ctx 32,768 and cut nothing.
  - qwen3.8: 15.4k per request in, and 37.8–46.8k out per run: its thinking
    filled the 16k output cap in 2 of 3 runs.

**What this says for the design:**
- **Length is not the only problem.** Rules buried in long text were read and
  not applied, and evidence was lost to compaction.
- **A shorter context helps** where it puts the rule next to the number it
  judges: in the result's verdict. It also helps where compaction keeps what
  the answer must cite.

---

## 4. Where the waste is

### 4.1 One rule, many homes

Mentions of each rule's words, arm B (measure.spec.ts §8):

| Rule | system | tool descriptions | skills | result criteria | homes |
| --- | ---: | ---: | ---: | ---: | ---: |
| symmetrised volume: partial UB fit; orientation needs the unsymmetrised file | 2 | 3 | 4 | 0 | 3 |
| an offset that changes with \|Q\| is not a UB error | 1 | 1 | 1 | 0 | 3 |
| a powder ring rises in nearly every direction | 1 | 0 | 2 | 1 | 3 |
| pedestal: trend and span both 0.8 or more | 1 | 0 | 1 | 1 | 3 |
| window weight on unmeasured space (≤ 1e-3) | 0 | 1 | 3 | 1 | 3 |
| a declared symmetry holds to ~1e-3 | 1 | 1 | 2 | 0 | 3 |
| Qmin/Qmax where the raw counts begin and end | 1 | 3 | 3 | 0 | 3 |
| measure another / off-zero cut before a verdict | 3 | 1 | 3 | 0 | 3 |
| Q² term for an inelastic pedestal | 1 | 1 | 7 | 0 | 3 |
| a stage's skill is read before its settings change | 1 | 1 | 3 | 0 | 3 |
| back-FFT r ≈ 1 only shows the transform ran | 2 | 0 | 3 | 0 | 2 |
| mark_region for a finding | 1 | 0 | 3 | 0 | 2 |
| dpdf_contrast before describing a ΔPDF figure | 1 | 0 | 3 | 0 | 2 |
| the Laue class is the user's to set | 1 | 1 | 0 | 0 | 2 |
| band and magnetic ion stay with the user | 0 | 1 | 3 | 0 | 2 |

**Single source, many copies.** The wording already has one source: the
verdict module's words reach the prompt (plan 1.6). But the model reads most
rules in three places. Some of those copies ride on every request (the system
prompt, the offered tools); others only after a read (the skills).

### 4.2 Prose where a contract would do

- **Tool descriptions explain algorithms.** Examples:
  - qmax_coverage spends 1,315 characters on how the reach is computed in each
    window mode;
  - ub_check, 1,317 on why a symmetrised volume hides a misorientation;
  - texture_check, 1,058 on the fill-bias test.

  `docs/algorithms/*.md` and the skills already hold this. A 400-character cap
  on all 28 would save at most 9,045 characters (2,584 est. tokens).
- **update_settings repeats itself.** It writes the supercell sentence three
  times, once each for H, K and L (about 750 characters), and lists the full
  catalogue in prose.
- **The system prompt routes to tools** whose own descriptions say the same.
  Examples: "describe_dataset for ranges", "dpdf_contrast sets the ΔPDF viewer's
  colour range", "grain_check reads every peak the search punched". It also
  describes tools a request may not offer: compare_laue_classes for the TASK.

### 4.3 Verbose results

| Reshape (same numbers) | before | after | est. tokens saved |
| --- | ---: | ---: | ---: |
| radial_profile: rows as a column table | 2,096 | 825 | 908 (61 %) |
| bragg_peaks: peaks as a column table | 2,071 | 1,044 | 734 (50 %) |
| assess_stage all: `criterion` once per reply | 3,277 | 2,055 | 873 (37 %) |
| dpdf_peaks: `reading` → description, sign in the size, equal duplicates dropped | 3,096 | 2,612 | 346 (16 %) |
| qmax_coverage: band_check and reach_from folded into the verdict | 1,270 | 937 | 238 (26 %) |

configure_settings (1,570 characters) was never cited on the dev run.

### 4.4 The opening context, in tools mode

- It costs 2,188 est. tokens on every request, plus 1.7k for the glossary that
  explains it.
- It is one cut, measured before the run the TASK starts with.
- No answer number came from it. It misled one model and, before the answer
  checks existed, fatally misled two.
- Indented JSON alone costs 522 est. tokens per request over compact JSON.

### 4.5 Compaction loses the method

- Past 24k estimated tokens, every result but the newest three is shortened at
  once. A skill becomes its 400-character head.
- On the budget test's method order this happens at request 5. From then on,
  the model works without the reduction-qc steps it read at request 2.

### 4.6 The estimator over-counts skill prose

Every tool result counts at 1.4 characters a token, the rate for number-dense
JSON. read_skill returns Markdown prose.

Real tokenizers count it far shorter. Characters per token:

| Text | estimator | gemma4:26b | qwen3:32b |
| --- | ---: | ---: | ---: |
| Skills (read_skill Markdown) | 1.4 | 3.91 (3.30–3.97 per text) | 4.01 (3.41–4.10) |
| Reference pages | 1.4 | 3.48 | 3.60 |
| Tool results (JSON) | 1.4 | 2.59 | 2.69 |
| — the densest: radial_profile as a column table, line_profile | 1.4 | 1.21, 1.31 | 1.21, 1.37 |
| System prompt, tool descriptions (prose) | 3.5 | 3.97–4.29 | 4.13–4.38 |
| Context block (indented JSON) | 1.4 / 3.5 | 2.10 | 2.39 |

- **The skills are over-counted 2.5–2.8×.** The worst turn's skills and page
  are 20,758 est. tokens and 8,006 real on gemma4: 12.8k tokens of the budget
  that the model never sees.
- **The data rate is right for digits, and only for digits.** line_profile
  today, and any column table, run denser than 1.4. They are under-counted, and
  only the server's calibration covers them (§5.7).


---

## 5. Design

### 5.0 Principles

1. **Correctness first.** Every hard rule and evidence requirement keeps a home
   the model reads when it needs it. A threshold the answer may quote stays in
   a number source the answer checks accept.
   - Those sources are (`numberSources`, agent.ts):
     - the messages the reply arrived with: the system prompt, the context and
       the user's turns;
     - this reply's tool results, skills read included;
     - earlier turns' results that still stand;
     - every tool's description, offered or not.

     A skill counts only if it was read in this reply. A threshold moved out
     of the system prompt must therefore land in a result or a description,
     not only in a skill.
2. **One home per rule:** the place the model reads at the moment the rule
   applies. In order of preference:
   1. the result that judges it (its verdict and terse criterion);
   2. the tool's description, for when to call it and its one gotcha;
   3. the skill, for method and judgment;
   4. the core prompt, only for rules that span tools (evidence, references,
      who decides what).
3. **Layers, by when they are needed:**
   - L0 core prompt, every request;
   - L1 tool contracts, while the tool is offered;
   - L2 skill core, read on demand and kept through compaction;
   - L3 details and references, read by section.
4. **Concise, never ambiguous.** A rewrite lists every sentence it drops and
   the home that keeps it (§5.2). A rule is cut only when its home is named.
5. **Budgeted.** Every model-visible change states its cost. The budget test
   shows headroom against a ceiling (§5.8).

### 5.1 Proposals

Each proposal gives its saving on the worst local turn:
- **est.:** the budget test's estimator;
- **real:** gemma4 / qwen3 tokenizers, where measured.

Savings are against main today. They overlap where noted.

#### C1. A state digest instead of the one-cut context, in tools mode **[behaviour]**

- **What.** With tools on, the first user message becomes a short digest:
  - dataset, cell, grid;
  - the stages on disk, and whether they follow the current settings;
  - symmetrised or not, and the declared symmetry when known;
  - the `notes`.

  It drops the cut's metric groups (ring_removal, bragg_punch, backfill,
  flatten, delta_pdf) and the glossary that explains them.
- **What stays.** Tools-off chat and the reviews without tools keep today's
  context and glossary unchanged.
- **The glossary's new home.** Its field meanings move, as a terse field list
  (about 1,200 characters), into `measure_reciprocal_cut` and
  `measure_dpdf_cut`, the tools that return those fields.
- **The reviews.** The one-click stage reviews with tools name their tool
  instead of the context's fields.
- **A safe first step** if C1 is declined: compact JSON (no indentation).
- **Saves:**
  - the context block, 2,188 → about 250 est. tokens (−1.9k), every request;
    in real tokens 1,477 → about 150 (−1.3k, gemma4);
  - with C2, the glossary's 1.7k est. (1,496 real) leaves the system prompt for
    about 340 est. in two tool descriptions;
  - compact JSON alone: −522 est. and −512 real. Indentation costs real tokens
    too: 2.10 against 2.46 characters a token.
- **Risk.**
  - Benefit: the model loses numbers it never cited (§3), and the source that
    misled qwen and, before the checks, gemma.
  - Cost: the model starts with no picture of the data until it calls a tool.
    On the TASK it runs the pipeline first anyway.
  - The stale-context rule becomes moot.
- **Verify:**
  - snapshots `1-chat-arm-b/c`, `3-stage-reviews`;
  - `context.test.ts`, `loadContext.test.ts`;
  - a local eval: watch for runs that call no tool, and for answers that lack a
    starting fact.

#### C2. A core system prompt

- **What.**
  - SYSTEM and TOOLS (13,908 characters in arm B) become one core of about
    2,300 characters, with the skills list kept as it is:
    - identity and stage order;
    - the four evidence rules;
    - the run checklist as stage → tool;
    - the acting rules;
    - who decides what.
  - Tool routing goes to the tool descriptions, which already hold it.
  - The glossary goes as in C1.
  - Arm C keeps the inference split: the checklist's order and imperatives are
    tagged, as today.
- **Draft, measured** (2,301 characters, 657 est. tokens; the first draft, at
  2,244 characters, counted 587 on gemma4 and 544 on qwen3):

  > You are NEBULA Pilot, the assistant in nebula3d. nebula3d cleans a 3D
  > reciprocal-space diffuse-scattering volume and transforms it into a
  > 3D-ΔPDF. Its stages run in this order: (1) ring removal, (2) Bragg punch,
  > (3) backfill, (4) flatten, (5) 3D-ΔPDF, (6) back-FFT check. The first user
  > message summarises the dataset as this request found it. After a run, that
  > summary is out of date: measure again.
  >
  > Evidence rules (the app checks every answer, and sends it back if it breaks
  > one):
  > 1. A verdict on a stage or check comes from its tool, called in this reply
  >    after the last run that recomputed the stage. Never grade a stage
  >    yourself. Whether the run met its goal is {{achieved}}, which the app
  >    computes: quote it and explain it.
  > 2. Write a tool's number as {{tool.field}}: the field's path in the result,
  >    with list items by index (e.g. {{ub_check.orientation_change_deg}},
  >    {{dpdf_peaks.features.0.length_A}}). Or quote the number exactly as
  >    returned, sign included. Every number must come from a tool result or
  >    the first message.
  > 3. One cut is not the volume. Before a verdict, use the tool that judges the
  >    whole volume, or measure a second cut.
  > 4. If the results lack what a question needs, say so. Never guess. Be
  >    concise and cautious.
  >
  > To judge a run, check each item and say which pass:
  > - rings: assess_stage rings;
  > - punch: assess_stage punch;
  > - backfill: assess_stage backfill and texture_check;
  > - flatten: assess_stage flatten;
  > - ΔPDF: assess_stage pdf, symmetry_check and qmax_coverage;
  > - problems in the data, which no setting fixes: ub_check and grain_check
  >   (UB, origin), qmax_coverage (counts).
  >
  > If one number improves, check that no other got worse.
  >
  > Acting:
  > - Run, tune and change settings yourself when asked: run_pipeline; or
  >   tune_pipeline or update_settings, then run_pipeline from the stage they
  >   return. Measure the same cuts before and after a change, and measure
  >   after every run. Say what you ran, what you changed and what that did to
  >   the numbers. Undo a change that made things worse.
  > - Name settings exactly as configure_settings gives them.
  > - Facts about the sample stay with the user unless they ask for a change:
  >   the modulation, the supercell, the |Q| band, the magnetic ion, the Laue
  >   class.
  > - When a result says ask_user, ask the user that question. Never answer it
  >   yourself.

- **What leaves, and its home:**

  | Leaves | Home |
  | --- | --- |
  | glossary | C1 |
  | look-up list, Follow and `show_in_viewer`, `mark_region` | their descriptions |
  | symmetry ~1e-3; `dpdf_contrast`, `dpdf_peaks` and `grain_check` routing | their descriptions and verdicts |
  | "leftover counts are not what the search found" | assess_stage punch's `search_note`, already in the result |
  | ub_check's caveats | its description and its new verdict |
  | Laue routing | compare_laue_classes' description and reduction-qc |
  | SNR-vs-r example | delta-pdf failure modes |
  | radial_profile for rings | reduction-qc step 5 |
  | "When an image is attached, describe what you see" | added to the core only when a message carries an image |
  | "Ground rules: base every statement on numbers in the context" | replaced by rule 2, which ends the conflict in §3 |
  | "Keep tool calls purposeful — a few well-chosen ones" | dropped: gemma stopped with rounds unused and skipped planned checks **[behaviour]** |

- **Saves:** system message 4,447 → about 1,150 est. tokens (−3.3k), every
  request. Net of the glossary's move into two descriptions, −3.0k.
  - In real tokens: SYSTEM and TOOLS are 3,453 (gemma4); the draft core is 587.
  - Net of the glossary's move, about −2.6k real.
- **Risk: medium.** Every request carries less method, and the model must find
  method in the skills and contracts.
  - Mitigations:
    - the checklist and the evidence rules stay in the core;
    - the verdicts carry their rules (C4);
    - the answer checks are unchanged.
- **Verify:**
  - `prompts.test.ts`, `inference.test.ts`, `armC.test.ts`;
  - snapshots;
  - a phrase test that each dropped sentence's rule is found in its home;
  - a local eval.

#### C3. Tool descriptions as contracts (§5.3)

- **What.**
  - Each description gets at most 500 characters: what it answers,
    `Returns:`, when to use it, one gotcha.
  - Parameter descriptions get at most 80.
  - The algorithm goes to `docs/algorithms/` or the skill.
  - update_settings keeps its catalogue in a terse grammar, states the
    supercell once, and states the user-facts rule once.
- **Saves:**
  - at most 2,584 est. tokens over the 28 tools at a 400-character cap;
    about 2.3k on the TASK's 25;
  - the four sketches: 6,641 → 3,045 characters, −1.0k est. and −843 real
    (1,684 → 841, gemma4);
  - in real tokens, about −2.0k on the TASK's offer.
- **Risk.**
  - A gotcha that moves to a skill is read only with the skill.
  - Arm C loses explanation (§5.3, decision 2).
  - Thresholds in descriptions are number sources. A threshold dropped from a
    description must be in its tool's result first (C4).
- **Verify:**
  - snapshot `2-tools*.md`;
  - the description lint;
  - `contracts.test.ts`;
  - `skillLint.test.ts` (numbers named);
  - a local eval.

#### C4. Compact results (§5.5)

- **What:**
  - signed sizes in dpdf_peaks;
  - `reading` moved to the description;
  - duplicates dropped;
  - column tables for radial_profile, bragg_peaks, line_profile,
    compare_datasets and the run_log lines;
  - terse criteria, the full text once per reply;
  - qmax_coverage's restated edges folded into its verdict;
  - configure_settings returns only non-defaults;
  - **a computed `verdict` in ub_check's result** (+about 60 characters: the
    0.05° rule where the model reads it).
- **Saves, measured on the samples:**

  | Result | est. tokens saved |
  | --- | ---: |
  | radial_profile | 908 |
  | bragg_peaks | 734 |
  | assess_stage all, `criterion` once per reply | 873 |
  | assess_stage all, criterion terse | about 515 |
  | dpdf_peaks | 346 |
  | qmax_coverage | 238 |
  | configure_settings | about 900 |

  - On the uncompacted worst turn: about −2.0k.
  - At its compacted peak, only dpdf_peaks is whole: −0.35k.
  - **In real tokens the reshapes save less**, since digits stay dense:

    | Result | real tokens saved (gemma4) |
    | --- | ---: |
    | radial_profile | 356 (34 %) |
    | bragg_peaks | 257 (30 %) |
    | assess_stage all, criterion once | 301 (27 %) |
    | qmax_coverage | 103 (23 %) |

    About −0.9k real on the uncompacted worst turn.
- **Risk.**
  - Column tables make references into rows index paths. Answers rarely cite
    these lists, and numbers stay traceable by value.
  - The signed size fixes a send-back failure.
  - ub_check's verdict adds evidence; it removes none.
- **Verify:**
  - snapshot `4-tool-results*.md`;
  - `contracts.test.ts`, `references.test.ts`, `answerChecks.test.ts`,
    `verdictPins.test.ts`;
  - a contract test that each verdict's numbers are in its result.

#### C5. Skill cores and references by section

- **What.** Each skill is:
  - a head of steps, one line each;
  - a `## Gates` section of at most 1,000 characters (the thresholds and
    rules, which compaction keeps);
  - steps with the judgment calls, at most 3,500 characters in all.

  Acceptance, failure modes and long explanations move to a `## Details`
  section, read with `read_skill(name, section)`, or into the reference page.
  Reference pages are read by section, with a section index first: the cap
  goes from 12,000 to 4,000 characters.
- **Saves, on the worst turn (two skills and one page):**

  | | chars | est. tokens at the data rate | at the prose rate |
  | --- | ---: | ---: | ---: |
  | read whole, today → C5 | 28,890 → about 11,000 | −12.8k | −5.1k |
  | compacted peak (method order) | | −8.2k (the stub grows from 468 to at most 1,600 characters: the gates) | |

- **In real tokens:**
  - the three reads, 8,006 → about 2,940 (−5.1k, gemma4);
  - the compacted peak, about −3.4k.
- **Risk.**
  - Judgment and failure modes are read only when asked for. gemma met the
    checklist in 0 of 7 answers when it was there.
  - The gates stay through compaction, which they do not today.
  - The text is the user's (decision 3).
- **Verify:**
  - `skillLint.test.ts` (each gate bound to its constant);
  - `skills.test.ts`;
  - snapshot `3-skills.md`;
  - `tokenBudget.test.ts`, with its gated-skill guards;
  - a local eval: skill re-reads should fall and checklist items rise.

#### C6. Count Markdown at its measured rate (§5.7)

- **What.** read_skill's Markdown counts at 3.0 characters a token, under the
  lowest rate measured (3.30), not at the data rate (1.4). Server calibration
  stays as it is.
- **Saves:**
  - no model-visible text;
  - at 3.0 characters a token, the worst turn's skills, 20,758 → about 9.6k est.
    tokens (−11.1k);
  - at the compacted peak, −7.9k.

  Compaction then triggers later, and Ollama's num_ctx is sized smaller.
- **Risk.** An under-count lets Ollama truncate a prompt silently, a
  correctness bug. The rate must come from real counts with a margin, and the
  window plan's MIN_REPLY refusal stays.
- **Verify:**
  - `realtokens.mjs` on gemma4 and qwen3;
  - `window.test.ts`, `tokenBudget.test.ts`, `ollama.test.ts`;
  - a local eval's server-counted tokens against the estimate (`usage`).

#### C7. Compaction that keeps the evidence (§5.6)

- **What:**
  - stale results digested first, at once;
  - evidence cards declared in each tool's facts;
  - the oldest result shortened first, one at a time;
  - skills keep their gates.
- **Saves:** nothing at the measured peak. It makes compaction lose nothing
  the answer may cite, and fewer re-calls.
- **Risk: low.** Stale results cannot back a verdict anyway.
- **Verify:**
  - `readings.test.ts`, `agent.test.ts`, `round.test.ts`;
  - a test that compaction keeps each tool's card;
  - a local eval (re-calls, `shortened` steps).

#### C8. Detail tools on request for do-everything questions (§5.4) **[behaviour]**

- **Saves:** about 0.9k est. tokens on the TASK after C3 (1.5k before).
- **Risk:** a wasted round per tool the model has to fetch.
- **Verify:** a local eval (rounds, empty answers). Last, and optional.

#### Combined

On the budget test's worst turn (estimator tokens, with the 6,144 reply
reserve, against 32,768). After C1–C5 the uncompacted turn is under the 24k
soft budget, so compaction no longer triggers: the uncompacted turn *is* the
peak.

| Turn | today | C1–C5, C7 | + C8 | + C6 | + C6, C8 |
| --- | ---: | ---: | ---: | ---: | ---: |
| peak request, est. tokens | 34,800 (compacted) / 43,841 (whole) | about 21,800 (whole, no compaction) | about 20,900 | about 17,600 | about 16,700 |
| + reply reserve | 40,944 / 49,985 | about 27,900 | about 27,000 | about 23,700 | about 22,800 |
| headroom under 32k | −25 % / −53 % | about 15 % | about 18 % | about 28 % | about 30 % |
| **real, gemma4: peak + reserve** | 28,006 (compacted) / 32,087 (whole) | about 20,300 (whole) | about 19,500 | = (C6 changes no text) | = |
| real headroom under 32k | 15 % / 2 % | about 38 % | about 41 % | | |

C1–C5 bring the worst turn under 32k **with every skill whole**: no stubs, and
no method lost to compaction. That much fits 32k, but not the 20 % target.
The target, plus the feature reserve, needs C6 (counting right) or deeper skill
cuts.


### 5.2 One home for each rule

| Rule | Home after | Removed from |
| --- | --- | --- |
| No verdict without its tool in this reply, after the last run that recomputed it | core prompt (rule 1), answer checks | — |
| Never self-grade; quote {{achieved}} | core prompt (rule 1) | run_verdict description keeps only what it returns |
| Numbers by reference; lists by index | core prompt (rule 2) | send-back keeps its own one-line form |
| One cut is not the volume | core prompt (rule 3) | glossary's "single 2D cut" line, skills' failure modes |
| UB turned at 0.05°; symmetrised volume gives a partial fit; \|Q\|-dependent offset is no UB error | **ub_check result** (`verdict`, new), ub_check description (one gotcha line) | system prompt, reduction-qc step 2 and failure modes (keep a pointer) |
| Powder ring = rises in nearly every direction (0.15 of median in 90 %) | assess_stage rings criterion (terse) | system glossary, reduction-qc step 5 (keep judgment: anomaly on ring-free data) |
| Pedestal = trend and span both ≥ 0.8 over the outer half | assess_stage flatten criterion | system glossary; reduction-qc step 6 keeps *when to turn Q² on* |
| Window weight on unmeasured ≤ 1e-3 | qmax_coverage verdict | qmax_coverage description, reduction-qc step 3, delta-pdf trust check 2 (pointer) |
| Declared symmetry holds to ~1e-3 | symmetry_check verdict | system prompt, reduction-qc step 7 |
| back-FFT r ≈ 1 only shows the transform ran | assess_stage pdf criterion | system glossary; delta-pdf trust check 4 keeps the reasoning |
| Band, magnetic ion, Laue class, modulation, supercell are the user's | core prompt (one line), enforced by update_settings | compare_laue_classes description's last sentence, reduction-qc step 3 |
| A stage's skill before its settings change | read_skill description + refusal text | skills list preamble (one clause), each skill's "Firm rules" |
| mark_region / show_in_viewer use | their own descriptions | system prompt; skills' "What to report" keeps one clause |
| dpdf_contrast before describing a figure | dpdf_contrast description | system prompt; delta-pdf keeps it in the checklist |
| ask_user is the user's question | core prompt (one line) + the result's own text | — |

### 5.3 Tool contracts

**Form.** Each description is at most 500 characters (lint), in four parts:
1. what it answers;
2. `Returns:` the fields to cite;
3. when to use it;
4. one gotcha.

The algorithm goes to `docs/algorithms/*.md`, which read_skill already serves
as references, or to the skill. Parameter descriptions are at most 80
characters.

Sketches, measured. They are illustrations; each rewrite is reviewed sentence
by sentence.

| Tool | now | sketch |
| --- | ---: | ---: |
| ub_check | 1,317 | 464 |
| qmax_coverage | 1,315 | 442 |
| texture_check | 1,058 | 480 |
| update_settings (catalogue kept whole) | 2,951 | 1,659 |

> **ub_check:** Is the volume's UB right? Fits the UB to the raw volume's
> Bragg-peak centres (the punch cell's nodes, low |Q| first). Returns verdict,
> rms_start → rms, the cell before and after, orientation_change_deg, radial
> (offset along Q per |Q| band), mean_offset_rlu, origin_shift_rlu. On a
> symmetrised volume only the symmetric part is fitted (fit "symmetric"): say
> so; the orientation needs the unsymmetrised file. An offset that changes
> with |Q| is no UB error. ~10 s.

The `verdict` field is new. It is the computed UB verdict that run_verdict
already gives, put where the model reads it.

**[behaviour] for arm C.**
- `descriptionWithoutSkills` is the only domain text arm C gets.
- Moving algorithm prose out of the descriptions changes what the ablation
  compares: arm C loses explanation it had, and arm B gains it only through a
  skill read.
- The redesign must say so in the validation's protocol, and the THY-52
  re-baseline must measure both arms on the new text.

### 5.4 Tool scoping

- Scoping already works for focused questions (12–17 tools). The TASK
  legitimately needs most checks.
- So on the TASK the saving must come from the contracts (§5.3), not from
  removing tools.
- Two narrow changes:
  1. **Detail and viewer tools on request.**
     - The tools: current_view, line_profile, bragg_peaks,
       consistency_details, run_log, dpdf_contrast, show_in_viewer.
     - gemma never called any of them on the TASK. Today they cost 1,480 est.
       tokens there; after the contracts, about 900.
     - For a do-everything request, offer them through a **`list_tools`** tool
       (one line each, about 450 est. tokens when called). A tool named from
       the list already runs, and joins the offer (agent.ts).
     - The loop offers run_log by itself after a failed run.
     - **[behaviour]:** the model must ask for these tools. A first call
       without the schema can cost a round, and gemma ran out of rounds once.
       Last in the order, and only if the eval shows no loss.
  2. **The prompt names a tool only where a rule spans tools.**
     - The core (§5.1, C2) names the checklist's tools and the acting tools.
       Any registry tool runs when the model names it (agent.ts).
     - The acting lines can be left out when the question does not ask to
       act, as the offer already decides (`ASKS_TO_ACT`, localTools.ts).
     - Lines that route to one tool (compare_laue_classes, dpdf_contrast,
       grain_check …) go to that tool's description.

### 5.5 Compact result formats

Conventions, enforced by a contract test on the snapshots:

- **Units once:** a `units` key per result (`{"q": "Å⁻¹", "r": "Å"}`), never
  per row. Several results do this already (`q_unit`, `width_units`).
- **Tables for bulk lists:** `{"cols": [...], "rows": [[...]]}` for lists of
  more than 4 rows that answers rarely cite: radial_profile, bragg_peaks,
  line_profile, compare_datasets, run_log lines.
  - Lists the answer cites (dpdf_peaks features, ring residuals) keep objects,
    so references stay readable
    (`{{dpdf_peaks.features.0.length_A}}`).
  - Numbers stay traceable by value either way.
- **Signed numbers carry their sign:** `size_sigma: −1520`, not `sign: "−"`
  beside `1520`. This fixes the dev-control send-back the model could not
  satisfy.
- **The verdict carries its rule tersely:**
  - `verdict` holds the outcome and the deciding numbers;
  - `criterion` holds at most 160 characters: thresholds and scope, no
    explanation;
  - the full criterion is sent once per reply per stage. The explanation lives
    in the skill.
  - A threshold an answer may quote stays in the result, so it stays a number
    source.
- **No boilerplate per call:** `reading` texts that do not depend on the call
  move to the description (dpdf_peaks), or go (qmax_coverage's restated
  edges).
- **Defaults are not echoed:** configure_settings returns the settings that
  differ from their defaults, plus a count of the rest. With `all: true`, it
  returns every setting. **[behaviour]:** small; the names stay in
  update_settings' contract.
- **A field must earn its place:** a new result field names who reads it (the
  answer, a verdict, the user, a later call) in its PR.

### 5.6 History and compaction that keep the evidence

1. **Skills keep their core.** Every skill gets a `## Gates` section (the
   thresholds and the rules), at most 1,000 characters. Compaction already
   keeps it (`readings/compact.ts`).
   - The skill's head (TEXT_HEAD) should be its steps in one line each, not
     the "Draft" status line.
   - Skill text is the user's (§8, decision 3).
2. **Stale results are digested first, at once.**
   - A result measured before a later run recomputed its stage cannot carry a
     verdict: the answer checks already refuse it.
   - It can shrink to its evidence card right after the rerun, whatever the
     budget, with no loss of usable evidence.
3. **Evidence cards, not generic pruning.**
   - Each tool declares in its facts the fields its verdict rests on (for
     example ub_check: verdict, orientation_change_deg, rms_start, rms,
     origin_shift_rlu).
   - A shortened result keeps exactly those, so `{{tool.field}}` references
     to them still resolve in the model's view. The checks keep judging
     against the whole result.
4. **Digest by age, not one cliff.**
   - Past the soft budget, shorten the oldest result first, one at a time,
     until the request fits. Today every result but the newest three is
     shortened at once.
   - Skills and the newest result of each verdict topic are shortened last.
5. **Earlier chat turns** stay as text (8 messages). An optional later step
   could cut each earlier answer to its first paragraph and its numbers. It is
   not proposed now; the gain (≤ 2k) is not worth the follow-up risk.

### 5.7 The estimator

- **Today.** Every tool result counts at 1.4 characters a token. Prose, tool
  definitions and the system prompt count at 3.5. A server's own counts then
  scale the whole estimate by the largest ratio seen
  (`observeTokens`). That ratio is one number for a mix of texts whose real
  rates differ by 3×.
  - The budget test pins the uncalibrated estimate. LM Studio at 32k plans its
    window with it until the first count arrives.
- **Proposal (C6).** read_skill's text counts at **3.0** characters a token.
  - That is 9 % under the lowest Markdown rate measured (3.30, a gemma4
    reference page).
  - Other tool results stay at 1.4.
  - The estimator keeps its calibration, and the window plan keeps its
    MIN_REPLY refusal.
- **A guard for the dense side.** A test counts every result sample's
  characters per token against the data rate, using the `--real` numbers
  recorded in a fixture. A result whose real rate falls below 1.4 must either:
  - be reshaped, or
  - carry its own rate (`ToolFacts.charsPerToken`), so that C4's column
    tables are never under-counted.
- **Effect:**
  - the worst turn's skills and page, 20,758 → 9,630 est. tokens (−11.1k);
  - the compacted peak, −7.9k.
- **What it is, and is not.** C6 makes the budget test and the guard measure
  what the model reads. It gives the model no room it does not already have:
  the room is real (§2.1).
- **Calibration stays the backstop.** After the first counted request, Ollama
  and LM Studio size and shorten on the server's ratio as today.


### 5.8 A token budget rule for every feature

1. **Headroom target: 20 % under 32k.** The budget test's worst local turn,
   with the reply reserve, must fit in 0.80 × 32,768 = **26,214** estimated
   tokens:
   - in the method order and the skills-last order;
   - after compaction.

   A stretch gate: the same turn **without compaction** fits 32,768, so
   compaction becomes a safety net rather than a necessity. The 56k run-policy
   check stays as it is.
2. **Ceilings, not pins.** The ±5 % pins catch drift in either direction, which
   makes every saving and every addition a re-pin.
   - The hard gate becomes the total (26,214 with the reply reserve).
   - Each component gets a ceiling, about 10 % over its projection after
     C1–C6. That shows where the feature reserve is spent, and the test prints
     the headroom left:

   | Component (worst turn) | projected after C1–C6 | ceiling, est. tokens |
   | --- | ---: | ---: |
   | system message | about 1,150 | 1,300 |
   | tools offered for the TASK | about 5,200 | 5,500 (each description ≤ 500 chars, lint) |
   | opening messages | about 460 | 600 |
   | skills read (two cores and one section, at C6's rate) | about 3,700 | 4,200 |
   | results | about 7,100 | 7,800 (each default-call sample ≤ 2,500 chars; 3 over today: assess_stage all and punch, dpdf_peaks on the dev control) |
   | reply reserve | 6,144 | 6,144 |
   | **total** | **about 23,700** | **≤ 26,214 (20 % headroom)** |
3. **Every model-visible PR states its cost.** The PR body carries the
   `scripts/measure_pilot_context.sh` delta by component, for example:
   "+180 est. tokens: compare_laue_classes result +120, description +60".
   A feature that needs more than its component's room must do one of:
   - cut as much elsewhere;
   - take a line from the feature reserve below;
   - get the user's yes to lower the headroom.
4. **New tools are scoped.** A new tool declares `offeredFor` topics; "always"
   needs a reason in its PR. Its description and default result fit the lint
   caps from the start.
5. **Feature reserve.** 2,500 est. tokens of the freed room are held for
   THY-59 to THY-62 (§5.9), inside the ceilings.

### 5.9 Room for THY-59, THY-60, THY-61, THY-62

| Feature | Model-visible surface | Cost | Under this design |
| --- | --- | --- | --- |
| **THY-59** Laue R_int statistics | compare_laue_classes result (χ²/dof, `common_flag`), description; a reduction-qc section | **measured:** result −22 chars, tools −21 chars, skill **+2,139 chars** (+1,528 est. at the data rate, about +610 at the prose rate) | Already in the design's shape: a terse result, the meaning in the skill on demand. Under C5 the section moves to reduction-qc's details, and its two gates (10 %, two SE) go into `## Gates`. Merge first, as built. |
| **THY-60** UB-aware punch | Python so far. Expected: a turned-UB diagnosis and tail-sweep counts in the punch record, through assess_stage punch / grain_check / run_pipeline | *estimate:* +200–400 chars of result, +100 of description: **≤ 300 est.** | Write the fields to C4's conventions: numbers with the verdict, no per-call prose, the rule in the criterion. ub_check's new `verdict` (C4) is its natural partner. |
| **THY-61** ring doublets | shells_judged entries (a doublet marker), possibly the rings criterion | *estimate:* +100–200 chars: **≤ 150 est.** | A field on the existing entries; the doublet rule's threshold in the rings criterion (a number source), its reasoning in reduction-qc's details. |
| **THY-62** powder-phase identification | likely a new tool and a skill section | *estimate:* contract ≤ 500 chars (about 150 est.), default result ≤ 2,000 chars (about 1,400 est., only when called), skill details about 1,500 chars on demand plus one gate line: **≤ 1,600 est. on the worst turn** | `offeredFor: ["rings"]` (not "always"); the phase verdict computed in the result; matching heuristics in the skill's details. |
| **Reserve** | | **2,500 est.** | Held inside the §5.8 ceilings. With C1–C5 alone the reserve takes the worst turn to about 30.4k (7 % headroom); with C6 to about 26.2k (20 %). In real tokens (gemma4) about 21.5k (34 %). |


---

## 6. Verification plan

Each step (R1–R6, §7) is checked before the next:

1. **Snapshot diffs** (`modelVisible.test.ts -u`, read the diff).
   - Every changed sentence appears in the PR's drop table with its new home
     (§5.0, principle 4).
   - Arm C snapshots are re-derived and read for what the ablation lost or
     gained.
2. **The budget test** with the ceilings and the 20 % headroom (§5.8).
   `scripts/measure_pilot_context.sh` before and after goes in the PR.
3. **The existing guards** must pass unchanged in intent:
   - replay and contract tests: `contracts.test.ts`,
     `contracts.replay.test.ts`, `knownAnswers.replay.test.ts`,
     `thy18.replay.test.ts`;
   - `skillLint.test.ts`, which binds the skills' numbers to the code's
     limits;
   - `answerChecks.test.ts`, and `inference.test.ts`/`armC.test.ts` for the
     arm-C split.
   - A gate that moves from the prompt into a result needs a lint entry that
     binds it there.
4. **New tests:**
   - a contract test that every number a verdict rests on is in its result;
   - the description and result lint caps;
   - "every rule in the drop table has a home", checked by phrase in the
     manner of skillLint;
   - compaction keeps each tool's evidence card.
5. **A local eval, free, on the dev split** (the synthetic validation cases;
   never the measured volumes, so not `eval-local.sh`'s scenario set):
   - Models: gemma4:26b (Ollama) and meta/muse-glimmer (LM Studio), arm B;
     arm C on gemma only. qwen3.8 was dropped by the user.
   - Runs: 3 per case, the same commit's harness, before and after each step
     group (R1+R2, R3, R4–R5). About 45 minutes per arm per model on gemma,
     at its measured one to two minutes a run. The steps are those of
     `docs/evals.md`, "Running it" under the validation: `nebula3d.validation
     make --split dev`, the web server on that root, then
     `validation.live.test.ts`.
   - Compared:
     - cases passed;
     - faults detected;
     - false alarms;
     - unsafe actions;
     - send-backs and whether the revision fixed them;
     - empty answers;
     - rounds used;
     - skill re-reads and shortened steps;
     - server-counted tokens per request (mean and max).
   - **Accept** a step when passes and detections do not fall, false alarms
     and unsafe actions do not rise, and tokens fall. A loss on any one case
     is read in its transcript before the step lands.
6. **The paid Claude eval** stays with the user (THY-52), once, at the
   re-baseline after the redesign and THY-59 to THY-62. Its cap and cost are
   stated before it runs.

---

## 7. Sequencing

THY-59 (`feat/laue-rint-statistics`, and `-skill` for its reduction-qc
section) and THY-60 (`feat/ub-aware-punch`) are in flight.
- THY-59 touches:
  - compare_laue_classes' description and result;
  - reduction-qc (+2,139 characters, about +1.5k est. tokens at the data
    rate);
  - the budget pins;
  - four snapshots.

  It already follows this design: a terse result, and the meaning in the
  skill, read on demand.
- THY-60 is Python only so far. Its model-visible part, if any, will be the
  punch record's turned-UB diagnosis and tail sweep, reaching the model
  through assess_stage punch, run_pipeline or grain_check.
- The shared hot spots: `2-tools.md`, `4-tool-results.md`, `1-chat-arm-b.md`,
  `3-skills.md`, `tokenBudget.test.ts`, `skillLint.test.ts`.

| Step | What | Model-visible | Waits for |
| --- | --- | --- | --- |
| R0 | Measurement script (this branch); budget test re-expressed as ceilings with a headroom report, passing on today's numbers; the per-feature rule in `docs/development.md` | no | — |
| THY-59 | merges as built (re-pinned) | yes | the user's skill-text review |
| R1 | Result formats (§5.5): signed sizes, ub_check `verdict`, terse criteria, prose dedupe, column tables | yes | THY-59 (it shares compare_laue_classes and the result snapshot) |
| THY-60 (TS part) | written to R1's result conventions | yes | R1 |
| R2 | Tool contracts (§5.3) | yes | R1 |
| R3 | Core prompt and context digest in tools mode (C1, C2) **[behaviour]** | yes | R2; the user's decision 1 |
| R4 | Skill cores, `## Gates`, reference by section (C5) | yes (skill text) | THY-59's skill section; the user's review |
| R5 | Compaction: stale-first, evidence cards, by age (C7, §5.6); the Markdown rate (C6, §5.7) | in effect: what is shortened, and when | R1 (cards name result fields); the user's decision 4 |
| local eval | dev split, before and after | — | after R2, R3 and R5 |
| THY-61, THY-62 | built inside the budget rule and the feature reserve | yes | R2 (contract form), R5 |
| R6 | list_tools for detail tools on the TASK **[behaviour]** | yes | eval evidence that it helps |
| THY-52 | re-baseline (local, then the paid run on the user's yes) | — | all of the above |

Each R-step is one PR. It rebases on main after any feature merge, so a
snapshot diff never mixes two changes. A feature PR that lands between R-steps
re-baselines only its own snapshots.

---

## 8. Decisions for the user

1. **The opening context in tools mode (C1).**
   - The choice: replace the one-cut metrics with a state digest, and move the
     glossary into the two cut tools; tools-off chat stays as it is.
   - *Recommended: yes.* No answer number came from the context. It misled
     one model, and before the checks it misled two.
   - It changes what the model starts from.
2. **Arm C after the contracts (C3).**
   - Tool descriptions lose algorithm prose, which today is arm C's only
     domain text.
   - *Recommended:* accept it, and re-baseline both arms at THY-52.
   - The alternative, a richer `descriptionWithoutSkills`, keeps the
     ablation's old meaning but grows arm C's offer.
3. **Skill text (C5): the text is yours.**
   - The proposal: I draft each skill as a head, `## Gates`, steps and
     `## Details`, for your review, and take the "Draft" line out of the head
     compaction keeps.
   - The skill interviews (`docs/SKILL_INTERVIEWS.md`) are still open. Should
     the restructure wait for them, or go first and absorb them later?
4. **The estimator (C6).**
   - The choice: count read_skill's Markdown at 3.0 characters a token, 9 %
     under the lowest rate measured, in place of the data rate's 1.4.
   - It is the single largest saving, and it changes no model-visible text.
   - It changes when compaction triggers and how Ollama's window is sized.
     *Recommended: yes*, after the real counts in §4.6, at the re-baseline.
5. **The headroom target.**
   - The proposal: 20 % under 32k for the worst local turn, after compaction
     (26,214 with the reply reserve), and ceilings per component in place of
     the ±5 % pins.
   - The stretch gate: the same turn fits 32k without compaction.
   - The question: is 20 % right, or 15 %?
6. **Detail tools on request (C8).** Try it after the eval, or not at all?
   *Recommended:* only if the eval shows no loss of rounds or answers.
7. **"Keep tool calls purposeful — a few well-chosen ones."**
   - Drop it from the prompt (C2)?
   - gemma stopped with rounds unused and skipped checks it had planned.
     Dropping the line leans toward more calls.
8. **The order** (§7). R1–R5 between THY-59 and THY-61/62, one PR each,
   before the THY-52 re-baseline. THY-60's TS part is written to R1's
   conventions.


---

## Appendix: reproducing the numbers

```bash
scripts/measure_pilot_context.sh /tmp/pilot-context              # estimator, synthetic, seconds
scripts/measure_pilot_context.sh /tmp/pilot-context --real        # + gemma4:26b and qwen3:32b tokenizers
scripts/measure_pilot_context.sh /tmp/pilot-context --real gemma4:26b
REALTOKENS_REQUESTS=first scripts/measure_pilot_context.sh /tmp/pilot-context --real qwen3:32b
```

`--real` loads each model in turn (17–20 GB) and unloads it after; check
`ollama ps` and `lms ps` first on the shared Mac. The components take about 10
minutes per model. A dense model needs several minutes for each of the long
whole requests; `REALTOKENS_REQUESTS=first` counts only the opening one. The
numbers in this document were measured on 2026-11-01, at main 8b9a865a.

The report (`report.md`) has the tables of §2 in full. `components.json` holds
every component's text; `realtokens.json` holds the real counts.
