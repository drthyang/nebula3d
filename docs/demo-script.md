# Demo script

A live demo of NEBULA3D in 5–10 minutes, on the synthetic demo volume only
(`synthetic_rocksalt`, simulated, not measured). The timings are those
measured in the [demo QA](demo-qa.md) on an Apple-silicon Mac with Chrome,
with a scripted model; a real model adds its own reply time, so time the
Pilot steps with your model in rehearsal.

| # | Step | Time on screen | Measured wait (browser · native) |
| --- | --- | --- | --- |
| 1 | Opening line | 0:30 | – |
| 2 | Load the demo | 0:30 | 3.2 s · instant |
| 3 | Run the pipeline, ask the Pilot to assess | 1:00 | 13 s · 24 s first run, 2 s after |
| 4 | Reciprocal views with highlights | 1:00 | page render < 0.4 s |
| 5 | Bragg profile and the UB turn | 0:45 | < 0.4 s |
| 6 | 3D-ΔPDF, then Q–R *Use in pipeline* | 1:15 | Run from ΔPDF 1.5 s · 3.3 s |
| 7 | Pilot chat with Apply cards | 1:15 | model reply |
| 8 | Auto mode | 1:30–2:30 | 2 min 33 s · 1 min 16 s (scripted) |
| 9 | Context meter | 0:20 | – |
| 10 | Wrap-up | 0:30 | – |

About 8–9 minutes. To fit 5, drop step 5 and show auto mode from its
screenshot.

## The click path

**1. Opening line.** "NEBULA3D takes a 3D diffuse-scattering volume from the
raw data to a 3D-ΔPDF: it removes powder rings, Bragg peaks and background and
keeps the crystal's own diffuse. It runs fully in the browser or natively,
and it has an agent, NEBULA Pilot, that checks and tunes the reduction, where
code, not the model, measures and decides."

**2. Load the demo.** Configure → **Use demo**. Say it is simulated: a
rock-salt crystal with short-range order, thermal diffuse, rods, and the
measurement's additions (Al powder rings, background, Bragg peaks, noise).
Native: the dataset is already selected.

**3. Run the pipeline.** **Run pipeline**. While it runs (ring removal is
most of it, 8–11 s), open the Pilot, check *Follow* and *Highlights* are on,
and send **Assess the run**. This is the first long step: talk over it.
Point at the Execution page's stage bar.

**4. Reciprocal views with highlights.** Reciprocal cleanup: raw →
ring-removed → Bragg-punched → backfilled → background-corrected, one plane,
one colour range. Switch H/K/L; type a cut. Turn on **HKL grid** (the integer
h, k, l lines). As the Pilot's checks land, the views show what each measured:
leftover peaks, punch holes, ring shells by code. The **Now examining** bar
names the step; its chips turn each class on or off.

**5. Bragg profile and the UB turn.** Bragg profile: peak widths against
|Q|, the resolution-limited share, the selected peak's three slices with the
fitted and measured ellipses. The **UB turn** line: on the demo the punch
reads no turn. If the Pilot ran `ub_check`, its arrows show each peak's shift
from a turn, scaled up.

**6. 3D-ΔPDF and Q–R.** 3D-ΔPDF: three linked real-space sections; the
alternating shells are the planted short-range order. Then Q–R Band
Transform: data, back-FFT, residual, and Pearson r in the header. Set a |Q|
band, **Apply**, then **Use in pipeline** and **Run from ΔPDF**: the one ΔPDF
that every page and the Pilot read is now band-limited. Do not press Undo
here (see the known issues).

**7. Pilot chat with Apply cards.** Ask for a proposal, for example "Check
the Bragg punch and propose any settings to change, with values." Point out
the tool steps, the computed verdict under the reply, and the **Apply cards**:
a setting applies through the same checks as the model's calls; a sample fact
(a supercell, the Laue class) applies only on your click, a one-use grant the
model cannot forge. Apply one, show it in **Changes**, **Undo** it. If the
model proposes no card, show `docs/media/pilot-apply-cards.jpg`.

**8. Auto mode.** **Run auto analysis**. Start it and talk over it: a fixed
plan (preflight, run, check each stage, report); the app runs the checks and
moves on by their verdicts; the model only fixes a flagged stage, two tries,
and writes the report. Point at the **Now line** and the activity log. Name
the limits: 30 minutes of working time, 12 model replies, $2 on Claude; Pause
and **Stop** always there, and Stop ends it with a report the app writes, at
no model cost. When it ends, open the **Report** (about 20 s in the browser:
talk through "Problems the checks found", written by the app, not the model).

**9. Context meter.** By the chat box: how much of the model's window the
next question takes. From 70 % it offers *Summarize and continue*, a summary
the app writes with no model call. Nothing is dropped silently: the chat
says when earlier turns are no longer sent. Show
`docs/media/pilot-context-meter.jpg` for the red state.

**10. Wrap-up.** "The reduction is deterministic and runs in the browser or
natively. The agent's verdicts come from tools, its numbers are filled in by
the app, its answers are checked before you read them, and facts about the
sample stay yours. It is validated on synthetic cases with a held-out test
split, against the default pipeline." Do not quote validation numbers until
the re-baseline is in the README.

## Fallbacks

- **Network or Pages slow:** use the native build (`nebula3d-web --data-root
  demo`, the [README](../README.md#quick-start) shows how to write the demo
  volume). Its reports open in about 1.5 s and auto mode is faster.
- **Model slow or down:** switch to the scripted path: the demo-QA scripted
  model, if you have it running (an OpenAI-compatible server; connect as
  *Custom*; "highlights" and "cards" give the replies shown in the
  screenshots). Otherwise show the screenshots in [docs/media](media/):
  `pilot-apply-cards.jpg`, `pilot-auto-done.jpg`, `pilot-auto-report.jpg`,
  `pilot-context-meter.jpg`, `qr-use-in-pipeline.jpg`.
- **Long steps:** start them first and talk over them: the Pilot's
  assessment during the pipeline run (step 3), the auto run (2.5 min in the
  browser), and the report (about 20 s in the browser).
- **A step stalls:** Stop in the Pilot, or reload. In the browser build a
  reload empties the engine: press Use demo and Run pipeline again (about
  15 s).

## Before the interview

- [ ] **CORS for the Pages site with a local model.** Ollama:
  `OLLAMA_ORIGINS="https://drthyang.github.io" ollama serve`. LM Studio:
  turn on *Enable CORS* in the server settings. The connection settings'
  hint shows the exact command.
- [ ] **The model is loaded** with a 32k context (LM Studio: default Context
  Length 32768; Ollama: the model supports 32k). Send one question to warm
  it up.
- [ ] **The demo is cached:** open the Pages site, Use demo and Run pipeline
  once, so the engine and wheel are in the browser cache.
- [ ] **The native build is ready** as the fallback: `make ui`, the demo
  folder written, `nebula3d-web --data-root demo` running in a terminal.
- [ ] **Screenshots open** in a tab or folder, for the fallback.
- [ ] **Follow and Highlights on**, Vision off, in the Pilot's toggles.
- [ ] **Known issues** ([demo-qa.md](demo-qa.md#known-issues-with-workarounds)):
  - Reports take about 20 s to open in the browser build (1.5 s natively).
  - An auto run takes about 2.5 minutes in the browser build with the
    scripted model; a real model adds its reply time.
  - Q–R: after Undo, the row with *Run from ΔPDF* goes away though the
    ΔPDF is still band-limited. Press Run pipeline on Configure, Force off,
    which remakes only the ΔPDF.
  - A local model on the Pages site needs CORS (above).
  - The build warns that a chunk is over 500 kB; nothing at run time.
