# NEBULA Pilot

NEBULA Pilot is the console's AI agent: a panel docked beside every page that
reads, judges, runs and tunes the reduction with you. Connect a local model
(Ollama, LM Studio) or a cloud one (OpenAI, Gemini, Anthropic); a cloud
provider shows a warning that your run data leaves your device. Every number
it quotes comes from the app's deterministic, unit-tested metrics and checks,
run in the browser or by the backend: the model reads and explains them, it
does not compute them. Getting it running is in
[QUICKSTART.md](../QUICKSTART.md#using-the-console).

## Tools

With *Tools* on, a reply is an agent loop of up to twelve rounds. The model
calls 24 tools, which run in the browser against the same API the viewers use:

- **Skills:** `read_skill` reads one of the user's methods (below).
- **Reading:** `describe_dataset`, `current_view`, `measure_reciprocal_cut`,
  `measure_dpdf_cut`, `line_profile`, `bragg_peaks`, `consistency_details`,
  `compare_datasets`, `configure_settings`, `run_log`.
- **Assessing:** `assess_stage`, `radial_profile`, `texture_check`,
  `qmax_coverage`, `symmetry_check`, `grain_check`, `ub_check`, `dpdf_peaks`.
- **Display:** `dpdf_contrast`.
- **Acting:** `update_settings`, `run_pipeline`, `tune_pipeline`,
  `show_in_viewer`.

Each is described under [How it works](#how-it-works).

## Guardrails

- **Answers stand on their evidence.** Before you read an answer, the agent
  checks that each verdict on a stage has the tool that measures it in the
  reply, measured after the last run that recomputed that stage (a run that
  reused a stage leaves its measurement standing), that every number comes
  from a tool result or the context, and that no claim contradicts a verdict a
  tool computed. A ring or punch verdict needs `assess_stage`, the ΔPDF's
  correlations `dpdf_peaks` (or a measured section), the origin `ub_check`.
  The check runs in code after the answer, not as a forced tool call, which the
  paid models do not take. A failing answer goes back to the model once; what
  still fails is noted under the reply (`answerChecks.ts`, `evidence.ts`).
- **Numbers by reference.** The model writes a tool's number as
  `{{tool.field}}`, the field's path in that tool's result
  (`{{ub_check.orientation_change_deg}}`, `{{assess_stage.flatten.max_floor_trend}}`),
  and the app fills it in from the result before you read it: the number is
  the tool's, as the tool rounded it. A reference that names nothing goes back
  to the model, and one still unfilled stays as written, with a note
  (`references.ts`).
- **Verdicts are computed, not self-graded.** `assess_stage` returns each
  stage's verdict with the rule behind it, by the check's rule in the
  check-verdict module (`verdicts/`), which the report reads too. The
  verdict on the whole run, `{{achieved}}`, is computed from the checks the
  reply ran: met when every stage, measured as it now is, meets its goal and
  no check on the result needs attention; not met, naming what needs it; or
  not judged, naming the stages not measured, and those measured on a grid
  too coarse for their check with that reason ("not judged: the ring removal
  (grid too coarse for the ring check)"). The data's problems that no
  setting fixes (a turned UB, a shifted origin, counts that end inside the
  box) are listed with it. It shows under a reply that judged the run (or
  found such a problem) and the report heads its own, and
  an answer that calls the run a success it does not give goes back to the
  model to quote it (`verdicts/`, `verdict.ts`).
- **Skills come first.** A stage's settings change, and the stage is tuned,
  only after its skill has been read in the conversation.
- **Tuning cannot touch your results.** Each trial runs in its own folder,
  never in `processed/`; the model proposes settings only from a checked
  catalog, every trial is measured on three planes, and a trial past a hard
  limit cannot win (a 3D-ΔPDF window with more than 10⁻³ of its weight on
  unmeasured space is one).
- **One run at a time.** Neither a run nor a tuning run starts while another is
  going, and *Stop* cancels the one the model started.
- **No loops.** A call repeated with the same arguments, with nothing
  changed in between, is not run again: the model is pointed at the result it
  has. A call to a tool that acts (its `acts` fact) always runs, and the
  readings after it run again. After two rounds in a row that brought nothing
  new, the model is asked to answer with what it has, and the reply says so.
- **A failing server is asked again, then explained.** A crash, a model
  unloaded, a dropped connection or a server gone quiet gets the same
  request again after a pause; what still fails ends the reply with what to
  do, never a bare error, and keeps the steps that ran.
- **A local model gets the tools its question needs.** All the tools'
  definitions come to about 5k tokens on every request, so a local model is
  offered the reading tools, the ones its question is about (the rings, the
  punch, the lattice, the 3D-ΔPDF …), and the ones that change the settings or
  start a run only when the message asks for an action (`localTools.ts`
  reads the question; each tool declares the questions it is for, its
  `offeredFor` fact, and one that declares none is offered for every
  question). A tool it calls by name all the same still runs and stays
  offered, as does one an answer check asks for.
  Cloud models get them all.
- **A long reply keeps its numbers.** Once a local model's request passes
  about 24k tokens, the reply's older tool results go back to it shortened to
  their verdicts, headlines and numbers, the newest three whole; a request too
  long for the window is shortened to its newest result before it is refused.
  The model can call a shortened tool again, and the answer checks always
  read the whole results.
- **No prompt is cut to fit.** A local server handed a prompt longer than the
  model's context window cuts it or fails, so each request is held to the
  window first. Ollama is asked for a window that holds the request (its own
  chat API takes the length per request; the OpenAI-style one cannot), and a
  request no window of the model can hold, or longer than the window LM Studio
  loaded the model with, is not sent: the reply says how to fix it.
- **A local model wants a 48k window.** With Tools on, a full assessment that
  reads two skills whole is about 45.6k tokens with room for the reply
  (measured through the agent loop: `web/src/llm/__tests__/tokenBudget.test.ts`).
  A 32k window still runs, but the guard then shortens the skills the model
  just read to stubs, and refuses a request that still does not fit; 48k
  (49,152 tokens) or more avoids that on long two-skill turns. In LM Studio,
  set the model's default Context Length to 49152 in its load settings (it
  reloads an idle model with its defaults), or load it with
  `lms load <model> --context-length 49152`. Ollama at its usual port gets
  its window from the app per request (`num_ctx`, up to the longest the model
  supports, which `ollama show <model>` lists), so the model must support 48k
  and the machine needs the memory for it; elsewhere, start Ollama with
  `OLLAMA_CONTEXT_LENGTH=49152`. The validation holds its local live runs to
  the same 48k ([evals.md](evals.md#the-models)).

## Evals

A suite of scenarios with known answers grades the agent on the tools it
called and what it answered, on a measured volume and on held-out synthetic
volumes with injected faults (a turned UB, a shifted origin, cut coverage,
powder rings). CI replays every scenario with a scripted model; real models
run it live, and a local tier holds a local model to an acceptance (at least
80 % of runs passing, no loops, no exceptions). The scenarios, the commands
and the results per model are in [evals.md](evals.md), which also holds the
validation on synthetic cases with a planted truth (the Pilot against the
default pipeline, with and without its skills).
[pilot-review.md](pilot-review.md) reviews each tool and skill.

## What its reviews found

NEBULA Pilot was used to review measured volumes as five domain experts in
turn: an instrument scientist, a crystallographer, a diffuse-scattering
physicist, a Fourier specialist and a statistician. Each review fixed what it
found, or built the tool it lacked. On a measured volume:

- The off-lattice search now leaves broad diffuse maxima alone. Before, most of
  the "leftover peaks" on a plane were such maxima.
- The flatten can take a background that rises with |Q|. The floor now sits
  near zero across the coverage, and the 3D-ΔPDF changed only near the origin.
- The coverage check reads the window that actually ran.
- The 3D-ΔPDF keeps the declared symmetry to rounding (`symmetry_check`).
- The 3D-ΔPDF page's Auto contrast shows the features, not the FFT ripple.

It was tested live with local models through LM Studio and Ollama, including a
five-stage tuning run. The details are in [CHANGELOG.md](../CHANGELOG.md).

## How it works

The assistant lives entirely in the browser (`web/src/llm/`) and follows a
*metrics-compute-the-truth, the-LLM-narrates* design: deterministic pure
functions derive real diagnostic numbers from the same slice envelopes the
viewers already fetch, and those numbers (never the raw volume) are sent to the
model as compact JSON. Nothing leaves the machine except the chat calls to the
model server the user configured — local providers keep everything on-device;
cloud providers are gated behind a data-leaves-your-device warning.

It is a panel docked beside every page (`web/src/llm/components/AssistantPanel.tsx`),
so it can move the viewer while the conversation stays in view. It never covers
the page: it takes a column of the app's grid, and the page reflows into what is
left (`web/src/components/PilotDock.tsx`, `web/src/state/dockLayout.ts`):

- **Docked** (a window at least 1000 px wide, or 900 px held landscape): a
  column on the right, about 28 % of the window at first (360–480 px). Drag its
  left edge, or use the arrow keys on it, to resize it between 320 px and 55 %
  of the window (at most 720 px); double-click the edge for the default. The header's chevron
  collapses it to a 44 px rail that opens it again.
- **Bottom sheet** (any narrower window): a sheet under the page,
  48 % of the window at first. Drag its handle to resize it between 30 % and
  85 %; the chevron collapses it to a bar.

The width and the sheet's height are remembered (localStorage) when a drag
ends. The page's own layouts respond to the width they are given, not the
window's (container queries on `.main`), so a narrower page beside the dock
lays out its views as a narrower window would. With *Follow* on, the figure
the Pilot lights up is scrolled fully into view beside it; on a phone the
sheet lowers, for the moment, until a square slice fits above it.

The conversation and any reply still streaming live in module-scoped stores
(`chatStore.ts`, `session.ts`), so collapsing the panel or changing pages does
not stop them.

**Skills.** The user's methods, one per topic, live in
`.claude/skills/<name>/SKILL.md`, where Claude Code reads them too:
`reduction-qc`, `bragg-node-audit` and `delta-pdf-interpretation`. All three
are drafts awaiting the user's interview (questions in
[SKILL_INTERVIEWS.md](SKILL_INTERVIEWS.md)). The system prompt lists only their
names and descriptions. `read_skill` reads a skill whole, or a document it
cites (a long one by section). A firm rule rides on them (`llm/skills.ts`): a
stage's settings change (`update_settings`) and the stage is tuned
(`tune_pipeline`) only after its skill has been read in the conversation.
Otherwise the executor refuses the call and names the skill to read. The ring
removal and the flatten belong to `reduction-qc`, the punch and the backfill to
`bragg-node-audit`, and the ΔPDF to `delta-pdf-interpretation`. The app's own
tool calls (the report's) are not gated.

**Answers stand on their evidence** (`llm/answerChecks.ts`). Before the user
reads a final answer, the agent loop checks it three ways:

- **No verdict without its evidence.** A verdict on a stage (the ring removal is
  clean, the punch missed peaks, the window stays inside the coverage, the ΔPDF
  keeps its symmetry, a second grain, the UB) needs the tool that measures it to
  have run in this reply. Small models had answered from the opening cut.
- **Numbers by reference.** Every number written must come from a tool result,
  the context, the user's words or the tools' guidance, within its written
  precision. A number found nowhere is listed.
- **Verdicts computed, not self-graded.** `assess_stage` returns each stage's
  verdict (*meets its goal*, *needs attention*) with the rule behind it, by the
  check-verdict module's rules. An answer that contradicts a tool's verdict is caught:
  a stage called clean that needs attention, a second grain that `grain_check`
  rules out, or a UB called right that `ub_check` turned or could not judge on a
  symmetrised volume.

A failing answer goes back to the model once, with what to fix ("Checking the
answer against its evidence…" shows meanwhile). What still fails is noted under
the reply. The text checks are heuristic: a false alarm costs one tool call, a
miss is a note.

- **`metrics/`** — one pure module per judgment, each unit-tested
  (`vitest`, `npm --prefix web run test`):
  - `rings.ts` — residual powder-ring energy (localized bumps in the radial
    profile of shell **medians**, so Bragg peaks left before the punch do not
    dominate; sparse shells near the origin and in the box corners are left
    out) before vs after, over-subtraction fraction, and a suggested display
    ceiling. Shells are binned in true |Q| under the reciprocal metric
    (`qRadius` in `context/pipelineContext.ts`), so rings stay round on
    hexagonal and monoclinic cells. Its floor is not 0: on the synthetic demo
    volume a perfect removal gives 0.42–0.55, which the ring stage reaches.
    It also judges the removal at each ring of the raw cut: the ring-removed
    profile across the ring against a line through the diffuse beside it, as
    a share of that diffuse (negative: a dent, the subtraction over-shot;
    positive: a ring left over), significant only beyond 3 × the flanks' own
    scatter. `assess_stage` counts a bump as a ring only if it rises in
    nearly every direction over the sphere, each judged in 3D on the raw
    volume (`GET /api/volumes/{id}/rings`, `preprocessing/ring_isotropy.py`):
    the crystal's own scattering makes bumps too, on every plane that symmetry
    makes equivalent. It names the plane and |Q| of the worst.
  - `punch.ts` — scans the *punched* slice for peaks the punch missed: each
    must stand 8 local σ above its own neighbourhood and span more than one
    voxel. Spikes in noisy or sparse-count regions (the coverage edge: a
    neighbourhood a quarter exact zeros, or below a tenth of the slice's
    median level) are counted apart. With the cut known, each peak is classed
    at a lattice node (honouring the punch cell) or off-lattice, on the
    search's protected planes or not, and sharp or broad by its FWHM: a broad
    one (≥ 5 voxels along a slice axis) is a diffuse maximum kept, not a punch
    candidate. It also summarises the fitted `BraggProfile`
    (resolution-limited fraction, measured widths, anisotropy).
  - `backfill.ts` — hole-rim seam magnitude (σ units), bright residual plugs, and
    a checkerboard-fraction that flags periodic interpolation artefacts.
  - `flatten.ts` — the per-|Q|-shell floors (25th percentile) before and after
    the flatten, in thirds of |Q|, the largest leftover floor in σ, and the
    pedestal removed. Over every well-measured shell out to the coverage
    edge, `floor_trend` (the floors' rank correlation with |Q|) and
    `floor_span_fraction` (their range against the diffuse level) catch a
    pedestal the σ test hides beside strong diffuse structure.
  - `dpdf.ts` — feature SNR vs background, strong-feature anisotropy (covariance
    ratio + orientation), radial trend, and back-FFT consistency pass-through.
- **`verdicts/`** — the check-verdict module: what each check's measurements
  mean. Each check (the five stages, the window against the coverage, the
  symmetry, the fill's texture, a second grain, the UB) has one entry in
  `rules.ts` with its rule, the words its tool writes, the criterion the rule
  is stated as and a stage's goal. The tools that judge call `judge`, which
  gives an outcome: met, needs attention or not judged, with its reasons and
  the data's problems no setting fixes. A check the grid is too coarse for
  (the ring check's 3D test, the fills' texture: pipeline.md) is not judged
  for that reason, "grid too coarse", its measurement saying why in the
  result the model reads (`ring_rule`, a cut's `not_judged`). On such a grid
  the ring removal subtracts no ring it could not confirm, and the rings'
  evaluation says so first (`notice`, from the stage's diagnostics: how many,
  what the grid needs, and the two ways out, a remedy arm C reads without).
  The outcome
  travels beside the tool's result, never in the text the model reads. `verdicts` reads a run's
  outcomes: a reply's for `{{achieved}}` and the answer checks, a report's for
  its cards and its goal. A result recorded without its outcomes (a replay, a
  validation record) is read from its words and numbers (`recorded.ts`).
  Where two readers read the same check differently, the reader matrix
  (`readers.ts`, and `rules.ts` for the rules' own) names the rule, D1 to D18,
  and its comment says the one line that would make them agree; a test pins
  each, and the user decides them one by one.
- **`context/`** — `loadContext.ts` fetches one cut through every stage (H–K at
  L=0 and the ΔPDF z=0 section by default, any cut on request) plus the run's
  records; `pipelineContext.ts` folds the metrics into the budgeted JSON
  context. **`prompts/`** — the domain system prompt (plus a tools section when
  tools are on) and the per-stage message builders. **`provider/`** — a
  dependency-free streaming client with function calling, OpenAI-compatible and
  through Ollama's own chat API (`/api/chat`), and Claude through Anthropic's
  SDK behind the same calls (`anthropic.ts`, loaded only when Anthropic is
  picked): system messages become the system prompt, a round's tool results go
  back in one user message, and a turn that called tools is replayed exactly as
  Claude returned it, thinking included. With Tools on, the first request alone
  is about 8k tokens and a full assessment that reads two skills about 45.6k
  with room for the reply (`__tests__/tokenBudget.test.ts`), so on LM Studio
  the chat reads the context length the model was loaded with
  (`/api/v0/models`) and, below 48k (`TOOLS_CONTEXT`, 49,152), says how far to
  raise it (`loadedContext`, `contextWarning`). The 48k is guidance: the
  window guard below goes by the window the model has. Before each request `provider/window.ts` estimates its
  tokens (`tokens.ts`): prose at 3.5 characters a token and data at 1.4 (tool
  results, call arguments and the fenced context JSON: a tokenizer may give
  every digit its own token), scaled by the largest ratio of the server's own
  counts to that estimate. Ollama goes through `/api/chat` with
  `options.num_ctx`: the length the model already runs with when it holds the
  request and 6k for the reply (another app may be using the model, and any
  other length reloads it under them, `/api/ps`), else the smallest of 8k, 16k,
  32k, 64k and 128k that does, never below what the model last ran with and
  within the longest context `/api/show` reports. A request that cannot fit is
  not sent. A reply that runs out of room ends with a note and runs none of its
  cut-off calls. A reply the server could not parse (a tool call in the wrong
  syntax) is asked again, up to twice. A request that fails the way a server on
  a shared machine does is asked again after a pause of 5 s, then 20 s
  (`recovery.ts`): the model crashed or was unloaded, or the connection dropped
  (twice each), the server ran out of memory or sent nothing, 5 min before a
  reply began or 2 min within one (once each). What still fails ends the reply
  with a note that says what happened and what to do; its steps and text stay,
  and the evals record the failure's kind apart from a wrong answer.
  **`settings.ts`** — a localStorage store (provider, model, key, temperature,
  vision and tools opt-ins).
- **Tools** (`tools/`, `agent.ts`) — with *Tools* on, a reply is an agent loop:
  the browser runs each call the model makes against the same API the viewers
  use, sends the JSON back, and the model continues — up to twelve rounds. Every
  argument is checked; a bad call comes back to the model as an error it can
  correct. The transcript lists each call, which opens to its arguments and
  result, and a long one shows a live line while it runs. As each measuring or
  assessing call finishes, the console moves to the figure it looked at
  (*Follow*, on by default; `tools/openView.ts`): the cleanup page at its cut (a
  stage's worst plane for `assess_stage`, the strongest fill bias for
  `texture_check`), the 3D-ΔPDF at its section, the Bragg profile with its peak
  selected, the Q–R band transform for the back-FFT check, or the Execution
  page for the run log. Each step's *Show* reopens its figure. While the panel
  is open, the cards the agent is on breathe a blue edge (`llm/highlight.ts`,
  `.ai-glow`): those a running step works on (narrowed to the stage a run or a
  tuning run is on), then those its answer mentions, for 8 s after the reply.
  The cleanup, 3D-ΔPDF and Q–R views, the Bragg profile panels, the Execution
  stages and log, and the Configure stage boxes all take it. A model or server
  that refuses tools gets the plain request and a note saying so. Each tool
  declares its facts beside its definition (`tools/facts.ts`): whether it only
  reads or acts, and on what; the verdicts it settles for the answer checks;
  the questions a local model is offered it for; its line in the transcript;
  the cards it lights; whether a reply that ran it gets a report; the skill it
  waits for. The agent loop, the answer checks, the report, the transcript,
  the highlights and the evals read them there instead of keeping their own
  lists of tool names; the model never sees them.
  - *Reading*: `describe_dataset`, `current_view`, `measure_reciprocal_cut`,
    `measure_dpdf_cut`, `line_profile`, `bragg_peaks`, `consistency_details`,
    `compare_datasets`, `configure_settings`, `run_log` (the last run's log).
  - *Assessing* — the checks the system prompt asks of every run, the five
    stages and the data's own problems that `{{achieved}}` reads
    (`assess_stage`, `radial_profile`, `texture_check`, `qmax_coverage`,
    `symmetry_check`, `grain_check` and `ub_check`):
    `assess_stage` judges a stage against its goal on the three principal
    planes (the tuning run's own evaluation, `tune/evaluate.ts`);
    `radial_profile` puts the stages' |Q|-shell medians side by side (rings
    left or diffuse dented); `texture_check` (`metrics/texture.ts`) asks
    whether the fills sit systematically above or below their rims (a
    lattice-periodic pattern; flagged at a median ≥ 0.5σ with ≥ 75 % of holes
    one way) and whether the punch and backfill add variation around each |Q|
    shell; `qmax_coverage` gives the share of the
    ΔPDF window's weight on unmeasured space, read from the ΔPDF's provenance
    (≲ 10⁻³ is clean), with the window's shape and scale. On a file without it,
    it compares how far the forward transform's window reaches in |Q| (the |Q|
    band if set, else the box faces, the coverage edge when tapered to it, or
    the box corners for a flat separable window) with the |Q| where shells
    stop being 95 % measured. With the window fitted to the coverage (the
    support on, an auto or ellipsoid window) the backend keeps at most 10⁻³ of
    its weight on unmeasured space by construction, so that weight, or the
    taper's reach, is its own target, not a check: the verdict says so, and
    judges where the counts end and a band that is set, which needs attention
    past the counts' edges. The coverage is measured once, in Python, on the
    raw volume's |Q| shells in 3D (`analysis/coverage.py`, served by both
    adapters: `GET /api/volumes/{id}/coverage` and the webbridge's
    `volume_coverage_json`); the principal planes only show where. It gives
    where the counts begin and end in |Q|, where a shell's voxels stop being
    mostly measured, finite and non-zero, with the box's nearest face. A
    volume that stores zeros for unmeasured space marks them measured: the
    window's support, the measured voxels, then runs past the counts, and no
    taper to the coverage follows them. It suggests the |Q| band
    they allow, and checks a band that is set. The Configure page shows the
    same edges under its |Q| band, with a *From raw data* button that sets
    the band to them. `symmetry_check` (`metrics/symmetry.ts`)
    compares a ΔPDF x–y section with its images under the cell's in-plane
    operations (hexagonal: six-, three-, two-fold and the a ↔ b mirror;
    orthogonal: the mirrors and the two-fold, and the four-fold when a = b), on
    the FFT's oblique grid; an
    operation the data were symmetrised with holds to ~10⁻³ or better.
    `grain_check` (`metrics/grains.ts`) takes the off-lattice peaks the
    punch's search recorded and groups them into orbits of the declared
    symmetry (from the volume's metadata). It tests the strongest two ways:
    against the Bragg nodes, where an orbit within a quarter of the node
    spacing is a displaced Bragg peak whose offset over |Q| bounds the
    rotation from below; and as a rotated copy of the Bragg lattice, a second
    grain, judged against the same search at random directions. A rotation
    under 2° is the UB, not a grain. `ub_check`
    (`analysis/ub_refine.py`, `GET /api/volumes/{id}/ub?cell=…&q_max=…`)
    measures each Bragg node's peak centre on the raw volume (the punch cell
    gives the nodes) and fits the UB that puts the centres on their nodes.
    On a volume symmetrised under its declared operations it fits only the
    changes that commute with them, since a misorientation is hidden there
    as rings. Elsewhere it fits the rotation and the cell. The cell is
    constrained by the declared symmetry; an unsymmetrised export declares
    none, so it takes the symmetry of the symmetrised export that names it
    as its `source_file`. It reports the
    peaks' offset along Q relative to |Q| by |Q| band and direction: an offset
    that changes with |Q| along a direction is not a UB error (see
    [UB refinement](algorithms/ub_refinement.md)). It also reports the peaks'
    mean offset from their nodes in r.l.u., before and after the fit: a UB
    error averages out over a centrosymmetric set of nodes and the fit removes
    it, while a shifted HKL origin moves every peak by one vector that stays,
    which it then names as the origin's shift. `dpdf_peaks`
    (`analysis/dpdf_features.py`, `GET /api/deltapdf/{id}/features`) lists the
    3D-ΔPDF's strongest extrema from the whole volume: local extrema above a
    few robust σ (default 5) outside the origin's disk, one per ± pair, each
    with its vector in Å and in lattice units (to a fraction of a voxel), its
    sign and its size in σ. The copies of one correlation are one entry: the
    extrema that are images of one another under the point group the raw
    file declares, else those of one sign, length and size (see
    [the ΔPDF's features](algorithms/delta_pdf.md#the-strongest-features-grouped-by-the-declared-symmetry-2026-10-19)).
  - *Display*: `dpdf_contrast` optimises the 3D-ΔPDF viewer's colour range in
    one call (the page's Auto rule, measured on the centre sections), reports the
    robust σ, the strongest feature and what the 99.5th and 99.97th percentiles
    would give, and warns when a range the user asks for is brighter than the
    optimum, where the FFT ripple shows. It acts: it sets the viewer's limit.
  - *Acting*: `update_settings` (the method choices and thresholds in
    `tune/catalog.ts`, and, when the user names them, the sample facts the
    tuner never proposes: the search's protected planes and the punch cell),
    `run_pipeline` (as the Run button: the console moves to the Execution page;
    without `from_stage` it computes what is missing, with it it recomputes from
    that stage on), `tune_pipeline` (below), and `show_in_viewer` (it acts on
    the view, as `dpdf_contrast` does). Neither run starts while another is
    going, and *Stop* cancels the one the model started.
- **Report** (`report/`, `components/ReportView.tsx`) — a reply that assessed,
  tuned or ran the pipeline gets a *Report* button. The report is measured
  afresh when opened (`report/collect.ts` runs the agent's own tools:
  `describe_dataset`, `assess_stage` for every stage, `texture_check`,
  `qmax_coverage`, `symmetry_check`, and `grain_check` once the punch has run),
  so its numbers never depend on which tools
  the model called or on its wording. The check-verdict module judges each
  card from the outcomes those tools return (`verdicts/`, the report's reader),
  and `report/report.ts` assembles the cards' headlines and details around
  them and lists every miss as a caveat.
  `report/figures.ts` draws the cleanup stages on one shared scale and the
  ΔPDF sections with the page's Auto, axes at their real angle.
  `report/render.ts` writes it as a self-contained HTML page (inline styles
  and PNGs; *Print / PDF* uses the browser's print) and as Markdown. The
  model's answer is included as a labelled summary.
- **Tuning** (`tune/`, the `tune_pipeline` tool) — the chat starts it when asked
  for the best result, and shows each stage's trials under that reply
  (`components/TuneProgress.tsx`). It runs the pipeline one stage at a time (rings →
  punch → backfill → flatten → ΔPDF). For each stage it runs the user's
  settings, asks the model for up to *n − 1* alternatives, runs each, measures
  every trial on the three principal planes (`tune/evaluate.ts`), and asks the
  model which trial best meets the stage's goal (`tune/prompts.ts` states each
  goal and its trade-off, e.g. no leftover peaks *without* punching more
  diffuse). The chosen settings go to the Configure page. The model can only
  change the settings in `tune/catalog.ts` — method choices and thresholds, not
  facts about the sample (supercell, protected planes, magnetic ion, |Q|
  band) — and every proposal is checked against it before anything runs.
  The tool's report holds every trial's changes and numbers, marking a trial
  whose numbers equal the current settings' as `no_effect`, so the model
  quotes the comparison rather than recalling it. A trial past a hard limit
  of its stage is no candidate while the user's settings keep it
  (`outOfBounds`). Today that is a ΔPDF window with more than 10⁻³ of its
  weight on unmeasured reciprocal space, the limit the backend's own window
  keeps. The ΔPDF stage also reports its x–y section's worst in-plane
  symmetry break, and the stage's note says why a trial was left out. When every tuned stage
  keeps the current settings, the later stages are not re-run.
  **Trials never touch `processed/`** (`nebula3d.server.tuning`). Each run gets
  a folder beside it, `tuning/<run>/`; each trial runs into
  `tuning/<run>/trials/<stage>-<n>/`, reading its input from the run's own
  chain, `tuning/<run>/processed/` (or from `processed/` for the stages before
  the run's first one — `run_pipeline(inputs=…)`). Keeping a trial copies its
  files into the chain, where the next stage reads them, and deletes the
  stage's trial folders; untuned stages between tuned ones are re-run once into
  the chain. A trial is measured through a dataset view of it,
  `<id>~tune~<run>~<stage>-<n>`, so every slice, Bragg-profile and
  back-FFT-check endpoint serves it unchanged; the chain, `<id>~tune~<run>`, is
  listed after its dataset in the sidebar once a stage is kept. The browser
  build does the same in its virtual file system (`webbridge.run`/`run_async`
  with `tuning_run`/`tuning_trial`, `tuning_start_json`,
  `tuning_promote_json`). `tests/test_tuning_runs.py` checks, through the
  library, the server's job processes and the bridge, that a tuning run leaves
  every file in `processed/` byte-identical.
- **Vision** (`render/sliceImage.ts`) — when enabled and the model is
  vision-capable, the rendered slice PNG is attached to stage reviews so the
  model can literally assess the image alongside the numbers.
