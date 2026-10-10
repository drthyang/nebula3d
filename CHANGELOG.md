# Changelog

## Unreleased

- **The UB can be refined from where the Bragg peaks sit.**
  `nebula3d.analysis.ub_refine` (and `examples/refine_ub.py`) finds each
  Bragg node's peak and fits one of four UB changes:
  - a rotation;
  - the cell, with the parameters the symmetry leaves free;
  - both;
  - only what commutes with the symmetry operations.

  The fit works from low |Q| outward, and the volume can then be regridded
  onto the refined UB. A volume symmetrised under its operations hides a
  misorientation as rings around the nodes, so it takes the last fit alone;
  the orientation needs the unsymmetrised data. Peak centres are windowed
  centroids. A centroid of the voxels above half height overstated sub-voxel
  offsets by a third, which read a cell 1 % off as 1.3 % off. See
  [docs/algorithms/ub_refinement.md](docs/algorithms/ub_refinement.md).
  On a measured hexagonal volume (symmetrised), the Bragg peaks sit
  0.2–0.5 % of |Q| outside their nodes, the same for weak and strong peaks.
  In-plane the offset grows with |Q|, which no UB can produce.
- **NEBULA Pilot can check the UB.** `ub_check` (and
  `GET /api/volumes/{id}/ub`) runs the UB refinement on the raw volume, with
  the punch cell as the Bragg nodes. It reports how far the peaks sat from
  their nodes before and after, the cell, the rotation, and the peaks'
  radial offsets by |Q| band. On a symmetrised volume it says that only what
  the symmetry keeps could be fitted.
- **Each peak is punched to its own width.** The punch's default footprint
  is now `own`: along H, K and L each peak's line-cut FWHM (half-maximum
  crossings interpolated) defines a Gaussian, punched out to where it falls
  to the stopping level over the local noise. The shared Bragg profile,
  kept as `punch_footprint="profile"` (*Profile-matched (shared width)* on
  the Configure page), gave a sharp spike on a broad maximum the wide punch
  of a Bragg peak of its height. On a measured hexagonal volume, own widths
  halved the share of the short-range-order maxima punched (0.65 % → 0.30 %),
  so no maximum lost half its box, where 32 had. They left no more Bragg
  residue, at 4.66 % of the volume punched against 4.36 %. 92 % of the
  peaks were measured; the rest keep the shared profile. **This changes
  the default punch mask.**
- **NEBULA Pilot can tell a second grain from displaced Bragg peaks.**
  `grain_check` groups the off-lattice peaks the punch's search found into
  symmetry orbits and tests the strongest two ways:
  - against the Bragg nodes: an orbit within a quarter of the node spacing
    is a Bragg peak displaced, and its offset over |Q| bounds the rotation
    from below;
  - as a rotated copy of the Bragg lattice (a second grain), against the
    same search at random directions. A rotation under 2° is the UB, not a
    grain.

  On a measured hexagonal volume there is no second grain: a rotated copy
  indexes 2 of the 40 strongest orbits (random directions: 4). 35 of the 40
  sit next to Bragg nodes at a median 0.85°. They are Bragg peaks
  symmetrised from data whose UB is off by about a degree; 5 remain
  unexplained. A volume's metadata now carries the symmetry its file
  declares. The agent's context counts the peaks the search punched off the
  lattice: a model had read the leftover count, which is only what the
  punch missed on one cut, as "no off-lattice peaks".
- **NEBULA Pilot writes an analysis report.** A reply that assessed, tuned
  or ran the pipeline gets a *Report* button. The report reads in the app
  and exports as a self-contained HTML page, which prints to PDF, or as
  Markdown. Its numbers come from a fresh measurement pass with the agent's
  own tools, never from the model's text. It holds:
  - the five stage checks, each judged by its stated goal;
  - the coverage, the raw counts' |Q| edges and the symmetry;
  - figures of the cleanup stages and the 3D-ΔPDF sections, drawn as the
    viewers draw them;
  - the dataset, the settings and sample facts, what the agent did, and the
    tuning trials with why each was kept or refused;
  - the caveats: every check that misses its goal.
  The model's answer appears as a labelled summary, with the model and
  provider named. Each check states, in a sentence, the rule its verdict
  follows. When the punch has run, the report also tests for a second
  grain: it flags a grain, or Bragg peaks displaced by a UB that is off.
- **The ΔPDF's |Q| band can come from the raw data.** The data's own Qmin and
  Qmax are where the counts begin and end: past either edge most voxels
  hold none. `GET /api/volumes/{id}/coverage` measures, per |Q| shell, the
  share of voxels holding counts (measured, finite and non-zero), and where
  it crosses one half. On a measured hexagonal volume that gave 0.52 and
  16.70 Å⁻¹, with the box's nearest face at 12.53 Å⁻¹. The Configure page
  shows the edges under the |Q| band, with a *From raw data* button that
  sets the band to them. `qmax_coverage` reports them, suggests the band,
  and says whether a band that is set stays inside the counts.
- **The |Q| band slider spans the whole box.** It stopped at the corner of a
  ±(4, 8, 15) r.l.u. crop that the ΔPDF does not apply: on a ±20 r.l.u.
  volume it ended at 13.5 Å⁻¹, while the counts reach 16.7.
- **The 3D-ΔPDF page's Auto shows the features, not the FFT ripple.** Auto
  put the colour limit at the 97th percentile of |ΔPDF|, but a ΔPDF section
  is mostly ripple around a few compact features, so that percentile
  measured the ripple. On a measured hexagonal volume it set the limit at
  8–17 × the sections' robust σ (0.5–3 % of the strongest feature): every
  feature saturated and the ripple filled the colour range. Auto now takes
  the 99.9th percentile over the three centre sections, with the origin's
  self-correlation disk left out (275 σ there). The features carry the
  colour and the ripple stays near the neutral colour.
- **NEBULA Pilot can optimise the ΔPDF view's contrast.** `dpdf_contrast`
  sets the 3D-ΔPDF viewer's limit by the same rule in one call. It reports
  the robust σ, the strongest feature, and what other percentiles would
  give and in which direction. It warns when a range the user asks for is
  brighter than the optimum. In a first version every call applied its
  limit, so a model trying a 5σ limit left the viewer there; now only the
  chosen limit is applied.
- **NEBULA Pilot warns before a small context window cuts replies off.**
  LM Studio loads a model with a fixed context length, often 4k or 8k. With
  Tools on, NEBULA Pilot's first request alone is about 8k tokens, so such a
  model broke off its first reply. NEBULA Pilot now reads the length the
  model was loaded with from LM Studio. Below 32k it shows above the chat
  how far to raise it, up to what the model supports. LM Studio unloads an
  idle model and loads it again on the next request with the model's default
  settings (here 8k again, hours after a manual 70k load), so the warning also
  covers a model that is not loaded, names the model's default Context Length
  as what to change, and is read again whenever a reply starts or ends, on
  connecting, on a model change and when the page regains focus.
  The connection help gives the Context Length for LM Studio and
  `OLLAMA_CONTEXT_LENGTH` for Ollama.
- **Tuning no longer trades a clean ΔPDF for a higher SNR.** The ΔPDF
  stage was judged on feature SNR and the round trip alone, though its
  goal requires the transform to stay inside the measured coverage. On a
  hexagonal volume a tuning run chose a separable window for 4 % more SNR.
  That window put 5.7 % of its weight on unmeasured reciprocal space
  (against 3 × 10⁻⁶ for the ellipsoid window) and broke the ΔPDF's
  six-fold symmetry (RMS 0.44). The stage's evaluation now reports the
  window's weight on unmeasured space and the x–y section's worst
  symmetry break. A trial past the backend's own limit (10⁻³, where its
  automatic window gives up the separable shape) is not a candidate while
  your settings stay inside it, and the reason is given.
- **Tuning no longer tries a punch setting that cannot act.** With the
  default profile footprint, the punch replaces the covariance fit's radii
  with the learned profile's, so freeing those radii from their bounds
  changed nothing: the trial's output was byte-identical. The tuning
  catalog now offers that setting only with the ellipsoid footprint.
- **A reply that fails keeps what it did.** An error from the model server
  late in a reply emptied it from the chat: after a 23-minute tuning run,
  LM Studio rejected the final report mid-stream, and the transcript kept
  only the question and the error. The run's steps, the tuning card and the
  text written so far now stay, with the error as the reply's note. When
  the error is the model writing a reply its server cannot parse (LM
  Studio: "does not match the expected … format", here a tool call in the
  wrong syntax; Ollama: "error parsing tool call"), the same request is
  sent again, up to twice, before the reply gives up. No tool runs twice.
- **Each plane's ring verdict follows the cross-plane rule.** A bump seen
  on one plane only is the crystal's own scattering, and the ring review's
  totals already left it out. Each plane's detail still named it as that
  plane's worst leftover ring, and a model reported three such bumps as
  misses of the ring removal. Each plane's residuals now mark them
  `single_plane_bump`, and its worst dent and leftover skip them.
- **Names keep their underscores in the chat.** Models often write field
  names such as `ring_energy_ratio` without backticks, and the chat's
  Markdown took the underscores for italics: the name read
  "ringenergyratio". As in CommonMark, an underscore inside a word is now
  a literal, and `*` or `_` makes emphasis only where it touches its text
  (`5 * 3 * 2` stays as written).
- **A reply cut off by a full context no longer breaks the conversation.**
  When a local model ran out of room in the middle of a tool call, NEBULA
  Pilot sent the half-written call back with the next request, and LM
  Studio failed that request and every later one with a bare HTTP 500.
  A reply that stopped for lack of room now ends the turn with a note on
  how to give the model more room, and none of its tool calls run. A call
  whose arguments are not JSON is sent back as `{}`. A bare HTTP 500 from
  the model server now says what usually causes it.
- **NEBULA Pilot can check the ΔPDF's symmetry.** `symmetry_check`
  compares a ΔPDF section with its images under the cell's in-plane
  operations and says which hold. Five expert reviews of a hexagonal
  volume had missed a 12.6 % break of its six-fold symmetry, which no tool
  could see.
- **A symmetrised volume gives a symmetric ΔPDF.** The ring removal, the
  backfill and the flatten each work on index-space neighbourhoods that the
  hexagonal six-fold does not map onto themselves. On a measured 6/mmm
  volume the ΔPDF lost 12.6 % (RMS) of its six-fold symmetry: equivalent
  Bragg peaks kept tails of up to ~1000 counts on one side of the backfill
  and not the other. With the declared symmetry (\`symmetry="auto"\`, the
  default), these stages now average their output over each orbit (and the
  backfill's band and the ring stage's spoke mask are closed under the
  group). The ΔPDF's partners agree to rounding, and its strongest
  equivalent features to one count in 2.5 million.
- **The conversation survives a reload.** Reloading the page emptied
  NEBULA Pilot's transcript and the unsent draft. Both are now kept for the
  tab (sessionStorage, up to about 1 MB of the newest turns) and come back
  after a reload; *Clear* forgets them. A reply still being written is lost,
  and its question says it was cut off.
- **A full context window says how to fix it.** When a local model's
  context window is too small, NEBULA Pilot showed the server's raw
  message. It now adds what to do: in LM Studio, raise the model's Context
  Length in its load settings to 32k and reload it; start Ollama with
  `OLLAMA_CONTEXT_LENGTH=32768`. With Tools on, the first request alone
  is about 8k tokens, and a full assessment reaches about 18k.
- **A tuning run's report holds every trial.** It returned only the chosen
  trial, so asked for each trial's numbers the model made one up ("12
  sharp leftovers" for a trial whose numbers matched the baseline's
  exactly). The report now lists every trial's changes and numbers. A
  trial whose numbers equal the current settings' is marked `no_effect`.
  When no setting changed, it no longer suggests rewriting the outputs.
- **The coverage check reads the window that actually ran.** It judged the
  transform by one reach radius from the Configure page's settings: on a
  hexagonal box (18 Å⁻¹ in-plane, 12.5 Å⁻¹ along c*) it reported a box-face
  taper that was not used. The ΔPDF now records the share of its window's
  weight on unmeasured reciprocal space (`window_open_weight` in its
  provenance and in the ΔPDF metadata, with the window's shape and scale).
  `qmax_coverage` gives that share as its verdict: 3.2 × 10⁻⁶ on the
  measured volume, clean.
- **The flatten can take a background that rises with |Q|.** Its model
  fitted a constant (plus the magnetic form factor), so on a measured
  hexagonal volume the diffuse floor still climbed from −1 to +10 across
  1–17 Å⁻¹ after the flatten. Inelastic background rises like that
  (thermal diffuse scattering, and with X-rays Compton scattering), starting
  out as Q². A *+ b·Q² term* switch (`flatten_q2`) adds it to the
  model. Like the other terms it varies only on the scale of the whole
  range, so pair correlations survive. Q² is only the leading term of a
  rise that saturates, so past the fit range's end the term is held at its
  value there. *Fit to |Q|* (`flatten_fit_q_max`) carries the fit past its
  old 10 Å⁻¹ end. The examples take `Q2=1` and `FIT_Q_MAX`; the punch
  example takes `SEARCH_MAX_WIDTH`. With both, the floor sat within
  ±0.5 of zero across the coverage. The ΔPDF changed only inside 1.5 Å,
  where the self term lands: RMS 3.3× lower there, every pair vector
  unchanged. NEBULA Pilot can turn both on.
- **The flatten check sees a leftover pedestal.** It judged floors in
  units of the slice's scatter and only inside the fit range. Beside
  strong diffuse structure, a pedestal spanning twice the diffuse level
  read 0.39σ, "flat". It now also reports `floor_trend` (the floors' rank
  correlation with |Q| across the whole coverage) and
  `floor_span_fraction` (their range against the diffuse level). Partial
  shells at the coverage edge are left out.
- **Leftover peaks are told apart by width.** The punch review counted
  every off-lattice leftover alike, so the short-range-order maxima kept on
  purpose read as missed peaks. On one plane of a measured volume that was
  176 of 188. Each leftover now carries its FWHM in voxels. Broad ones
  (5 voxels or more along a slice axis) are reported as diffuse maxima
  kept, and only the sharp ones as punch candidates. The headline states
  both counts.
- **The off-lattice search can leave broad maxima alone.** It punched any
  candidate tall enough, so on a hexagonal volume whose superstructure is
  short-range order (maxima about 4 × broader along l than the Bragg
  peaks), it cut out the strongest of the very signal a 3D-ΔPDF images.
  *Search width ×Bragg* (`punch_search_max_width_ratio`, off by default)
  leaves a candidate broader than that many Bragg widths along any axis.
  The Bragg width is measured at the strongest integer peaks. A candidate
  within a quarter of the node spacing of a punched Bragg node is that
  peak's wing and is punched anyway. Spurious reflections are as sharp as
  Bragg peaks on every volume measured, so 2 keeps them punched. Widths
  come from line cuts above a straight baseline through the points five
  voxels either side, so a sharp spurious peak on a broad maximum's flank
  still measures sharp.
- **The Configure page shows the punch footprint that runs.** Its "Method"
  select offered only *Ellipsoid* and was never sent, while the pipeline
  punched with the profile-matched footprint. *Footprint* now offers
  profile-matched (the default) and ellipsoid, with the profile's reach
  (*Profile reach ×σ*). NEBULA Pilot can change both, and can set the punch
  cell when asked.
- **A new sample starts from the default settings.** A dataset seen for
  the first time used to inherit the form as it stood, so a second compound
  started with the first one's magnetic ion and protected planes. Another
  temperature of the same sample still carries the settings over.
- **Only rings seen on two planes count as rings.** A powder ring is
  isotropic. A bump on one plane only is the crystal's own scattering,
  which the ring removal must leave. It was read as a ring "left over".
  It is now listed apart.
- **The back-FFT check is described for what it is.** Without a band or
  crop the round trip is the identity, so r ≈ 1 only shows the transform
  ran correctly. The model was told it showed the ΔPDF was trustworthy.
- **The AI Assistant is now NEBULA Pilot.** The sidebar, the panel and the
  model's own introduction use the new name.
- **Ring removal is judged at each ring.** For every powder ring in the raw
  cut, assessments and tuning report whether the ring-removed profile ends
  level with the diffuse beside it: a dent (the subtraction over-shot,
  though no voxel need go negative) or a ring left over, as a share of the
  diffuse there. A residual counts only beyond 3 × that diffuse's own
  scatter on the plane. A dip in a shell's low percentiles is not proof of
  a dent: on a measured volume it was the rings' counting noise, which
  widened the shells' spread by 30–60 % while their medians stayed level.
  Only the strongest Al line kept a real dent, about 2–3 %.
- **Configure remembers its settings for each dataset**, and the console
  remembers the selected dataset across reloads. Facts about one sample,
  such as its protected satellite planes, no longer carry over to the next.
- **The leftover-peak scan sets sparse counts aside.** Near the coverage
  edge most voxels are empty, so the local scatter is all but 0 and a
  single count reads tens to thousands of σ. On three measured volumes,
  every leftover the scan reported on the H = 0 plane was such a count at
  the K edge (75 at 28 K), and so were the two "missed lattice peaks" it
  reported at 45 K. A would-be peak whose surroundings are a quarter exact
  zeros, or sit below a tenth of the slice's median level, is now counted
  with the noisy spikes.
- **Leftovers on the search's protected planes are counted apart.** The
  punch review reports how many off-lattice leftovers sit on the protected
  H planes, where they stay by design, so the model no longer takes every
  off-lattice leftover for a protected satellite. The stage summaries also
  name the plane and |Q| of the worst ring dent or leftover, and the
  strongest leftover peak.
- **NEBULA Pilot can set the search's protected H planes when asked.** It
  refused to, though they are on the Configure page, because the settings
  it may change left out every fact about the sample. Asked by name, it now
  sets *Search skips H* and its half width. A tuning run still never
  proposes them: whether those planes hold real satellites is physics, not
  a threshold to trade against a metric.
- **A tuning run stops once its tuned stages keep your settings.** It used
  to re-run every later stage anyway, reproducing the processed outputs: a
  few minutes of work on a 401×401×301 volume.
- **The leftover-peak scan no longer takes noise for peaks, or misses real
  ones.** It judged each spike against the whole slice's noise and accepted
  single voxels. On a measured 401×401×301 volume, 675 of its 697 hits on
  one plane were noise at the coverage edge, while resolved peaks with a
  contrast below 4 went unflagged. A peak now has to stand out in its own
  neighbourhood (8 local robust σ) and span more than one voxel. Spikes in
  noisy regions are counted apart. With the cut known, each peak is classed
  at a lattice node (a missed Bragg peak, honouring the punch supercell) or
  off-lattice (a satellite or a spurious peak). Assessments and tuning
  report the two separately.
- **The off-lattice search's floor and protected H planes are settings.**
  The punch protects the H = n ± 1/3 planes from its search, and needs a
  peak to clear 27 × the diffuse scatter. Both were fixed, so twin or
  harmonic peaks on those planes, some at ~700σ, could not be punched from
  the app. *Search floor ×σ*, *Search skips H* (`1/3, 2/3`, `none`) and its
  half width are on the Configure page and in the API
  (`punch_search_floor`, `punch_search_protect_h`,
  `punch_search_protect_half_width`). The floor is also on the tuning list.
- **The flatten is judged over its own fit range (0.8–10 Å⁻¹).** The floor
  check included the direct-beam core, which is punched and smoothly filled,
  so a clean flatten could read 2σ.
- **The assistant changes only the settings you ask for.** Asked to turn
  off the search's protected planes, it set the integer punch's H guard to
  0 instead. That ran every node's punch along H and discarded diffuse: 49 %
  more voxels punched. The H guard's description now says what it is, and
  `update_settings` tells the model to ask when unsure. A setting already at
  the value is reported as no change.
- **Assess the run** names the tool for each check, so the model runs the
  texture and coverage checks instead of guessing. It also reports any
  other stage that misses its goal, such as the flatten. `assess_stage`
  says which planes it measured.
- **Two datasets at one temperature have distinct names** ("22K · cc",
  "22K · sub bkg") in the sidebar, Configure and the assistant.
- **The cards the assistant is on breathe a blue edge.** While a step runs,
  the cards for what it works on glow. A pipeline run or a tuning run lights
  the stage it is on. While the answer is written, the cards it mentions
  glow, for 8 seconds after the reply ends. This covers the cleanup panels,
  the 3D-ΔPDF and Q–R views, the Bragg profile panels, the Execution stages
  and log, and the Configure stage boxes, and only while the assistant panel
  is open. The edge holds still for users who ask for reduced motion.
- **The console follows the assistant to each figure it assesses.** As a
  measurement or assessment finishes, the console moves to the figure it
  looked at, so you see what the model sees:
  - the cleanup page at the cut, at a stage's worst plane, or at the
    strongest fill bias;
  - the 3D-ΔPDF section;
  - the Bragg profile, with the peak selected;
  - the Q–R band transform, for the back-FFT check;
  - the Execution page, for the run log.

  A *Follow* chip beside *Tools* turns this off. Each step's *Show* button
  reopens its figure either way. The transcript also names the assessment
  steps, instead of showing their tool names.
- **Anthropic is a provider for NEBULA Pilot.** Pick *Anthropic* in the
  connection settings and paste a Claude API key. The model list puts Claude
  Opus 5.5 first. Claude runs through Anthropic's official SDK, called from
  the browser like the other cloud providers, with the key kept in this
  browser. The SDK loads only when Anthropic is picked (59 kB gzipped). Chat,
  tools, stage reviews and tuning all work with it.
  - The model's reasoning streams into the *Thinking* panel.
  - A request a safety classifier declines is re-run on another Claude
    model in the same call (server-side fallback).
  - A declined reply never runs its tool calls.
- **A shorter Ring removal stage on the web Configure page.** The empty
  "radial PV fit · ring-width estimate" placeholder is gone. The texture
  figure takes its place and sets its equations beside the schematic, so the
  pooled model's equation is no longer cut off. The ring parameters sit
  two-up under the model, which takes the Global 3D controls from seven rows
  to four.
- **Ask the assistant to run and tune the analysis, and watch it work.**
  Asked to process the data, the model used to explain the steps and tell you
  to press Run, because no tool could start one. It now has three:
  - `run_pipeline` runs the pipeline as the Run button does: it computes the
    missing outputs, or recomputes from a given stage on. The console moves to
    the Execution page, and the chat step shows the stage, its progress and
    the latest log line. The model then measures the new outputs.
  - `tune_pipeline` runs the stage-by-stage tuning and reports each stage's
    trials live. It reports what it kept, then writes the outputs with the
    chosen settings unless you said otherwise.
  - `update_settings` changes a method choice or threshold from the tuning
    list, when you ask for a change or ask it to improve the result.

  *Stop* also cancels the run or the tuning run the model started. A reply
  can now use up to twelve rounds of tool calls instead of six. With
  gemma4:26b on Ollama, "Please process the data for me" ran all six stages
  of the synthetic demo volume and then reported metrics from its outputs.
  "Tune the knobs to get the best results" tuned all five stages (12 min),
  reran the pipeline with the chosen settings, and reported the change in
  each stage's numbers.
- **One chat instead of Chat and Tune pipeline tabs.** The trials table of a
  tuning run now appears in the chat, under the reply that started it, with
  the link to the tuned result. Two one-click requests join the stage
  reviews: *Assess the run* and *Tune for the best result*.
- **The assistant judges every run on four checks, with tools to settle
  them.**
  1. Is the ring removal clean?
  2. Are the Bragg peaks removed cleanly?
  3. Did the punch and backfill add texture to reciprocal space?
  4. Is Qmax past the data coverage?

  New tools:
  - `assess_stage` judges a stage against its goal on the three principal
    planes, with the evaluation the tuning run uses.
  - `radial_profile` puts each stage's |Q|-shell medians side by side.
  - `texture_check` flags fills that sit systematically above or below their
    rims: a median of at least 0.5σ, with at least 75 % of holes the same
    way. It also flags variation the punch and backfill add around each |Q|
    shell.
  - `qmax_coverage` compares how far the forward transform's window reaches
    in |Q| with where shells stop being 95 % measured.
  - `run_log` reads the last run's log.

  A higher ΔPDF feature SNR no longer counts as a gain if the back-FFT r falls
  or the window reaches past the coverage. Each stage review also calls that
  stage's assessment tools.
- **A reply without an answer is no longer dropped.** A model that only
  thinks, or returns nothing, now leaves a note in the chat instead of
  silence. An error a server streams after its first response chunk now
  shows as an error.
- **NEBULA Pilot can act: it measures, looks up and shows.** With *Tools*
  on, the model can measure the stage metrics on any reciprocal cut or ΔPDF
  section (the opening context covers only L=0 and z=0), take a line profile
  through any stage, read the fitted Bragg peaks and the full back-FFT check,
  compare datasets, read the run settings, and open the viewer at the cut that
  makes its point. The browser runs each call and sends the result back; every
  argument is checked, and the transcript lists each call with its result.
  These tools only read. A model that cannot call tools still answers
  from the opening metrics, with a note saying so.
- **The assistant can tune the pipeline, one stage at a time.** *Tune
  pipeline* runs each stage with your settings and with up to four the model
  proposes, measures every trial on the three principal planes, and keeps the
  trial the model judges best against the stage's stated goal and trade-off.
  The chosen settings go to the Configure page, and each stage builds on the
  best result of the one before. The model can change only method choices and
  thresholds from a fixed list, never facts about the sample.
- **Tuning never writes to `processed/`.** Each trial runs into its own folder,
  `tuning/<run>/trials/<stage>-<n>/` beside `processed/`, reading its input
  from the run's own chain of kept outputs; the chosen trial is copied into
  `tuning/<run>/processed/` and the stage's other trials are deleted. The tuned
  result opens as a dataset of its own (*"… · tuned HH:MM"* in the sidebar).
  Natively and in the browser build, a test runs a tuning run and checks that
  every file in `processed/` is byte-identical afterwards; on the synthetic
  demo volume a five-stage, fifteen-trial run through the app left all nine
  processed files byte-identical (sha256).
- **The assistant is a panel beside every page**, opened from the sidebar
  instead of a page of its own, so it can open a viewer while the conversation
  stays in view. A reply keeps running when the panel closes. On narrow screens
  the panel slides over the page.
- **The ring-removal metric now sees the rings.** It averaged each |Q| shell,
  and before the punch a shell's mean is mostly Bragg peaks, with the
  incident-beam spot in the few voxels near the origin: on the synthetic demo
  volume it gave a ratio of 1.00 both for the ring-removed volume and for the
  same volume generated without rings. It now uses shell medians and leaves out
  sparse shells: 0.42–0.50 for the ring-removed volume against 0.42–0.55 for
  the ring-free truth, on the three principal planes. Its shells also follow
  true |Q| under the reciprocal metric, so rings stay in one shell on
  hexagonal and monoclinic cells (they were binned as if a* ⊥ b*).
- **The assistant sees the flatten stage.** Its context and a new *Check
  flatten* review report the per-|Q|-shell floors before and after the
  flatten; the ΔPDF is built from the flattened volume by default.

- **Structure overlay on the 3D-ΔPDF.** Load a CIF, or enter sites and
  symmetry operations by hand, and the 3D-ΔPDF page (and the Q–R page's ΔPDF
  view) marks the structure's interatomic vectors r_j − r_i + R on each slice:
  one glyph per element pair, a filter for the vectors from one site, a depth
  around the cut, and a hover readout of the pairs, |u| and u. The CIF's cell
  is checked against the ΔPDF's, with an axis mapping for another setting. The
  structure stays in the browser. On a synthetic rock-salt volume with ordering
  planted on the cation sublattice, the markers fall on the planted ΔPDF
  features (negative at ⟨½ ½ 0⟩, positive at ⟨1 ½ ½⟩ and ⟨2 0 0⟩).
- **\|Q\| boundaries are drawn correctly for non-orthogonal cells.** The Q–R
  page drew the \|Q\| band as circles on the r.l.u. axes, which is right only
  for an orthogonal cell; it now draws the true contour under the reciprocal
  metric, a tilted ellipse (off-centre where the cut axis is not normal to the
  plane) that bounds the band-limited data. The punch preview's \|Q\| band,
  which was already tilted, now also moves its centre for an off-origin cut,
  and the ΔPDF \|Q\|-band slider takes its maximum from the true metric. The
  computation was already right; only the drawing changed.

- **`main` now reports version `0.4.0.dev0`** (web: `0.4.0-dev.0`), not
  `0.3.0`. Default results have changed since the 0.3.0 beta, so files written
  from `main` no longer claim to come from that release.
- **The Bragg punch no longer depends on the data's intensity units.** Its
  floors were numbers in data units (0.8, 1.0). On data of another scale,
  such as X-ray rates against neutron counts, or two runs on one instrument,
  they either rejected real Bragg peaks or stopped protecting the diffuse.
  The pipeline now does three things:
  - **Integer nodes by significance alone** (`integer_detect="significance"`).
    The excess at the window's brightest voxel over its own background shell
    (1–2× the resolution ellipsoid, as in peak integration) must reach
    `min_significance`, corrected for picking the brightest of the window's
    voxels (5σ becomes ≈ 6σ). The shell leaves broad diffuse maxima at nodes
    alone. On a synthetic volume, none of the forbidden-node short-range-order
    maxima are punched, and every Bragg node is.
  - **No broader than a Bragg peak** (`integer_max_shell_fraction=0.15`). A
    node is also rejected when the 1–2× shell still holds over 15 % of its
    core's excess (against a 3–4× shell), by more than two standard errors.
    Bragg peaks keep a few per cent there. Maxima a few times wider pass the
    shell test on good statistics, and a punch sized for a peak would take
    their core and leave their skirt.
  - **Search floors in units of the diffuse scatter**
    (`search_floor_unit="scatter"`, 27 × the per-shell 1.4826·MAD). That is
    the old 0.8 on the data it was tuned on. The run log prints the scatter
    and the floors.
  - **Same mask at any scale.** Multiplying the data and `sigma` by any factor
    gives the same mask.

  Effects:
  - On X-ray volumes on a 2×2×2 cell, every strong parent reflection is
    punched as before, and more of the weaker ones than with the floors. The
    broad maxima at the supercell nodes are left whole.
  - On a hexagonal neutron volume, the short-range-order maxima at its
    non-parent nodes, which the floors had punched, are left alone.
  - On orthorhombic neutron volumes the punched volume changes by a few per
    cent.

  To keep the earlier behaviour, set `integer_detect="floors"`,
  `search_floor_unit="data"` and the search floors to 0.8.

  The web Configure page's *Min I* field becomes *Min σ*, the significance a
  peak must reach. With the gate off (Min σ 0), integer nodes fall back to
  the floors. See docs/algorithms/bragg_cleanup.md.
- **No more dashed streaks along the 3D-ΔPDF axes.** The transform windowed
  the volume, subtracted the plain mean from the whole box and zero-padded
  it, which left a step of the mean at the box faces; its transform drew a
  line of alternating sign along every axis, a sizeable fraction of the
  strongest correlation on both a hexagonal and an orthorhombic dataset. It
  now subtracts the window-weighted mean before windowing, and the Gaussian
  window is shifted to reach zero at the box edge (FWHM 3 % narrower in Q;
  ΔPDF amplitudes a few per cent lower). The streak drops by more than an
  order of magnitude on both datasets; the back-FFT check stays near-exact
  and improves slightly. See docs/algorithms/delta_pdf.md.
- **The flatten's magnetic ion defaults to none.** The model then subtracts a
  fitted constant only; choose the sample's magnetic ion to add the
  `c·F(Q)²` paramagnetic term. The old default ion put its form factor on
  every sample: on a hexagonal dataset it fitted a negative c, a negative
  paramagnetic term, to follow a pedestal that rises with |Q|. The example
  scripts (`run_pipeline.py`, `flatten_background_3d.py`,
  `validate_flatten.py`) default to none too; set `ION` for a magnetic sample.
- **The slice viewers share one workspace, after the NeXus Viewer.**
  Reciprocal cleanup, 3D-ΔPDF and Q–R now lay out, zoom and set colours the
  same way, and the same way as the NeXus Viewer.
  - **Layouts.** *Grid*, *Focus* (one large view, the others as thumbnails;
    2 × 2 with four) and *Single* (Esc returns), with focus / maximize in each
    view's header. Remembered per page. Defaults: grid for Cleanup and
    3D-ΔPDF, focus with Data large for Q–R.
  - **Zoom and pan on the slice.** *Navigate · Zoom · Move* click modes,
    double-click to fit, pinch, axes in r.l.u. or Å, a field-of-view chip and a
    crosshair shared by linked views, with a readout of every stage's value
    under it. On 3D-ΔPDF a Navigate click moves the other two cuts. These
    replace the *Zoom* and *Window* sliders, which pointed opposite ways (Zoom
    ×2 zoomed in on Cleanup but out on the Bragg tiles; a larger Window zoomed
    out).
  - **Colour range instead of *Contrast*.** vmin and vmax around a colour bar
    with the data's histogram and a handle at each limit, *asinh / lin / log*,
    *Auto* (vmin 0, vmax at p97, softening at the median, as in the NeXus
    Viewer) and *Brightness* in stops, right brighter. *Contrast* multiplied
    vmax, so raising it darkened the image.
  - **The diffuse is visible by default.** Cleanup's shared scale now comes
    from the output stage. It came from the pooled stages, so raw's Bragg
    peaks set it: on measured data the flattened median sat at a tiny
    fraction of the range and needed *Contrast* at its ×0.1 minimum.
  - **Q–R fixes.** *Apply* sits next to each band and no longer snaps both
    cuts to the centre. The residual has its own ± range on a diverging map;
    it was drawn from 0 on the data's sequential scale, which hid every
    negative value. The Q scale is set from the centre cut, so it holds still
    while the cut moves. The ΔPDF plane follows the Q plane (H ↔ x, …) while
    *Link orientation* is on; the page opened with 0kl next to xy.
  - The Bragg tiles take *Brightness* and a *Zoom* that zooms in.

- **Volumes indexed on a supercell.** New punch setting `supercell` (default
  1×1×1). With a supercell, integer mode punches only the parent lattice's
  nodes, those whose h, k, l are multiples of the factors. On a volume
  indexed on a 2×2×2 supercell, `mode="both"` also punched the odd
  (superlattice) nodes, which carry no parent Bragg peak, and took part of
  the intensity there. Run such a volume with `mode="integer"`,
  `supercell=(2, 2, 2)` and the H guard off: the rods and superlattice nodes
  then stay intact. The H guard (`integer_h_guard_hkl`, 0.12 r.l.u., set to
  protect satellite planes at fractional H such as H = ±1/3) is now a setting
  too. On such a volume it left a Bragg tail along H. Both are on the server
  (`punch_supercell_h/k/l`, `punch_h_guard`, 0 = off) and on the web
  Configure page, whose punch preview marks only the parent nodes. The
  defaults are unchanged.
- **The flatten subtracts a fitted const + c·F(Q)² pedestal.**
  - **What it does.** It still takes each |Q| shell's floor (p25). It then
    fits `const + c·F(Q)²` to those floors over 0.8–10 Å⁻¹ and subtracts the
    fitted curve, instead of the smoothed floor itself.
  - **The two terms.** `const` is nuclear incoherent scattering.
    `c·F²` is the paramagnetic scattering of each ion by itself, with `F` its
    magnetic form factor. Both are self scattering, so they change the ΔPDF
    only at r ≈ 0.
  - **Why the floor had to go.** The old floor, smoothed at 0.1 Å⁻¹, also
    followed the isotropic `sin(Qr)/(Qr)` terms of real pair correlations and
    subtracted them.

  On measured data at three temperatures, compared with no flatten, the old
  floor pulled the ΔPDF's short-range shell means strongly negative, while the
  model moves them only slightly. Both reduce the axis cross.

  On the demo ground truth, the old floor's ΔPDF error at 2–5 Å was 42 %,
  against 13 % with no flatten.

  The model keeps most of the cross suppression. What it leaves is a smooth
  isotropic part that is not F²-shaped. That part may be real isotropic
  correlation or a background the model lacks (multiple scattering, the
  sample environment, the Debye–Waller fall-off of the incoherent constant).

  - **Form factor.** `F` is the dipole form, ⟨j0⟩ + (2/g − 1)⟨j2⟩. It fits the
    measured floors better than ⟨j0⟩ alone at every temperature.
  - **New module.** `nebula3d.preprocessing.form_factor` has the coefficients
    for 22 3d and rare-earth ions (International Tables C §4.4.5,
    cross-checked against Mantid).
  - **Settings.** `ion` (the magnetic ion; `None`/`"none"` fits a constant
    only) and `fit_q_range` are new options on `flatten_radial_background` and
    `FlattenParams`. On the server the ion is `flatten_ion`.
  - **Where the default changed.** The stage driver, the flatten example, the
    QA script and the web Configure page now default to the model. The web
    page gains a Magnetic-ion select. `estimator="floor"` and `"snip"` remain
    for comparison.
  - **Limit.** For Ising-like moments the self term is `F²(1 − (Q̂·ê)²)`, and
    only its shell average is removed.
- **No bright rim around a filled hole.** On a hexagonal TOPAZ volume, bright
  nodes came out as "coffee beans": a ring brighter than the fill inside it.
  There were two causes.
  - The Laplace fill takes its boundary `laplace_gap` voxels outside the
    punch, past the Bragg tail left at its edge, but then kept that band's
    measured values. Every hole was therefore ringed by the tail its fill had
    skipped: a median step of a fraction of σ on both the orthorhombic and
    the hexagonal data. The fill now writes the band too, and meets the kept
    data only at its boundary.
  - The profile punch's template dropped a halo common to every direction as
    thermal diffuse. A peak can have such a halo of its own: one that falls
    off exponentially and, relative to the peak, does not grow with |Q|. The
    template now follows the measured profile on every axis. On data without
    such a halo, the punch grows only slightly.

  On both datasets the median step from the fill to the first kept voxel
  falls to about zero. The fill now replaces the band's measured voxels, the
  punch grows, the back-FFT check improves slightly, and the ΔPDF barely
  changes at short range.

  On the moved-hole test the written band is unbiased, with the scatter of a
  3³ box mean. `laplace_gap=0` still changes only the
  punched voxels. See `docs/algorithms/bragg_cleanup.md`.
- **Laplace is the default backfill, judged on real data.** A new test,
  `bragg_qa.refill_test` (also `REFILL=laplace,local` in
  `examples/qa_punch_fill.py`), measures fill error where the truth is known.
  It moves the punch's own holes half a node step along K, into measured
  diffuse, fills them, and compares with the data there. The moved holes keep
  the real shapes and stay lattice-periodic.

  On orthorhombic data at three temperatures (profile punch), the per-hole
  mean error is a few hundredths of σ for both fills and smaller for
  `laplace`; the ΔPDF error at the lattice vectors is a few per cent of the
  real ΔPDF there.

  The two fills are equal in the ΔPDF within the test's scatter. `laplace`
  leaves no step at the hole rim (`local` leaves a clear one) and follows gradients
  across the long merged holes of the profile punch. Fills that continue the
  rise toward each node are not used: that rise is mostly the residual Bragg
  tail the punch leaves at 0.5σ.

  Defaults changed in `backfill_bragg`, `BackfillParams`, the stage driver and
  presets, the preview, the benchmark and the web Configure page;
  `method="local"` restores the shell median.
- **The Bragg punch follows each peak's own tail.** Stacked along their local
  axes, the brightest peaks of the orthorhombic data have:
  - a compact core, the same width in every direction;
  - no radial tail;
  - an exponential tail along θ̂ (toward c*), out to several tenths of an
    Å⁻¹ above the noise, and a shorter one along φ̂.

  The tail scales with intensity, grows with |Q| and is the same in every
  dataset: the tilt spread (mosaic). The old punch fitted the core, which
  cannot see the tail, then grew it by the cube root of the intensity. Its base
  radii even had θ̂ as the shortest axis. On the low-temperature dataset over
  a third of a bright punch was background, yet most of the brightest holes
  had a tail leaking on one side.

  `punch_footprint="profile"`, now the default with `profile_n_sigma=0.5`:
  - learns the dataset's Bragg profile along each peak's (ρ̂, θ̂, φ̂) from its
    ≤ 400 brightest integer peaks, per |Q| range, with neighbouring peaks
    masked out;
  - keeps the Gaussian core plus the excess of the transverse profiles over
    the radial one, so a halo common to every direction (thermal diffuse) is
    not learned;
  - punches each peak along each axis to where its predicted tail falls to
    0.5 × the local noise, between the resolution radii and 0.5 Å⁻¹. There is
    no intensity scaling.

  Against the old punch and the significance gate, on all three datasets the
  new punch clearly lowers the share of the brightest holes leaking a tail
  (by about half on the low-temperature one) and of all holes leaking a tail.
  The background share of the punch stays about the same, more voxels are
  punched, and the back-FFT check stays near-exact.

  In the ΔPDF the change is mostly a loss of RMS from 5 to 40 Å and at the
  lattice vectors; the short range (2–5 Å) barely moves.

  Caveats:
  - more of the punch sits in merged holes, as tails join neighbouring L
    nodes;
  - it also removes thermal diffuse that streaks across Q around nodes, like
    the demo volume's, so the demo benchmark scores 2–3× the collateral. The
    learned profile is in the Bragg profile JSON (`footprint_profile`) for
    checking a new sample.

  With too few bright peaks it falls back to the ellipsoid and says so in the
  run log. `punch_footprint="ellipsoid"` restores the old punch
  (`PUNCH_FOOTPRINT` / `PROFILE_N_SIGMA` in the driver; `punch_footprint` /
  `punch_profile_n_sigma` in the run request). `bragg_qa` also reports each
  hole's background share.
- **The Bragg punch judges every detection against its own error.** Before,
  the search pass flagged a voxel when it beat its |Q| shell's median + 4·MAD
  and an absolute floor of 0.8. Both are set by the whole shell. At the
  high-|Q| edge of the CORELLI coverage, low exposure turns one or two
  counts into a spike of order 1, with noise several times the interior's.
  - On the low-temperature dataset about half the search peaks were such
    spikes, all below 5σ, most of them single voxels.
  - Their punches merged into two large holes, a sizeable share of
    everything punched, which the `local` fill then filled with one value
    each.

  Now a detection, integer node or search summit, needs an integrated
  excess of at least `min_significance` = 5 standard errors (`PunchParams`;
  `MIN_SIGNIFICANCE=5` in the `cc_on`/`cc_off` presets):
  - `z = Σ(I − bg)/√Σσ²` over half the resolution ellipsoid, with `bg` the
    detection window's median and `σ` the volume's errors;
  - `significance_noise="mad"` uses the window's robust scatter instead,
    for volumes without real errors;
  - a voxel without a usable `σ` falls back to the window's robust scatter.

  The scaling reference still counts the candidates the gate rejects, so
  the punches that stay keep their size.

  On the low-temperature dataset (shipped code against main, full pipeline):
  - the edge punch shrinks by a large fraction; the interior punch is
    essentially unchanged;
  - one mmm-symmetric family of interior integer nodes, just below the gate,
    is lost;
  - the back-FFT check improves slightly, most on the H = 0 plane;
  - the ΔPDF moves by a few per cent RMS at the lattice vectors and within
    20 Å, all of it from the restored edge.

  The other two datasets show the same small back-FFT gain, again most on
  the H = 0 plane.

  No change in the tails left past the brightest holes at any of the three.

  The profile JSON gains each peak's `significance`; the run request gains
  `punch_min_significance` (0 = off). `detect_window_q` sizes the detection
  window in Å⁻¹ but stays off: on measured data it adds many integer nodes,
  not yet validated.
- **Punch / backfill QA**, `nebula3d.analysis.bragg_qa`, two examples:
  - `examples/qa_punch_fill.py` (real data) reports:
    - how significant each detection is;
    - hole sizes and merging;
    - excess in shells outside each hole by distance in Å⁻¹ (a tail leaking
      on one side shows in the first shell's 90th percentile);
    - the fill against those shells.
  - `examples/benchmark_punch_fill.py` (ground truth) scores the punch and
    fill on the demo volume, whose components are known: Bragg left, diffuse
    removed, false detections, fill bias, and 3D-ΔPDF error at the lattice
    vectors. It has a clean scenario and a low-exposure-edge one. On the
    edge one the gate cuts false detections 1,284 → 12 and collateral
    81 % → 59 % (clean: 46 %).
  - Both already show the next targets on measured data: the `local` fill
    sits a fraction of σ below each hole's rim, and on the demo it under-fills the thermal
    diffuse under the nodes by ~75 %.
- **Every HDF5 output is now a Mantid MDHistoWorkspace NeXus file.** The stage
  volumes (`*_ringremoved.h5`, `*_braggpunched.h5`, `*_backfilled.h5`,
  `*_flattened.h5`, the web demo) and the 3D-ΔPDF (`*_delta_pdf.h5`,
  `examples/_delta_pdf.h5`, `*_3dpdf.h5`, the consistency viewer's saved
  band) were written in two ad-hoc layouts that only NEBULA3D read. They now
  use the layout Mantid Workbench's `SaveMD` writes (version 2, copied from a
  CORELLI file), so `LoadMD` and other NeXus tools open them, and the unit cell
  sits in `experiment0/sample/oriented_lattice` (UB/2π and a, b, c, α, β, γ).
  File names and extensions are unchanged. Also:
  - arrays keep their stored order: a volume `(nh, nk, nl)` is D2 = `[H,0,0]`,
    D1 = `[0,K,0]`, D0 = `[0,0,L]`; a ΔPDF `(na, nb, nc)` is D2 = x, D1 = y,
    D0 = z in Å (frame General Frame), with the bin edges LoadMD expects;
  - signal, σ² and `num_events` are float64 and the mask int8 (1 = masked), as
    LoadMD requires. A float32 run converts slab by slab (no float64 copy of
    the volume) and records its precision, which `dtype=None` restores. Files
    of a float32 run grow by ~1 B/voxel (~7 against ~6 compressed); float64
    files are about the same size;
  - the ΔPDF provenance (`q_max`, `apodization`, `source_file`,
    `transform_config`, …) is stored as run logs, so it shows in Workbench's
    Sample Logs;
  - what Mantid does not know goes in `MDHistoWorkspace/nebula3d`: the exact
    bin centres and UB, the precision, the instrument text and the punch
    record (`punched`, int8). A file NEBULA3D wrote loads back losslessly,
    values under the mask included, so a pipeline resumed from disk equals one
    run in memory; a raw Mantid file still has its masked voxels zeroed;
  - one reader for ΔPDF files, `nebula3d.io.load_delta_pdf`, used by the
    server, the stale-ΔPDF guard and every viewer; the writer is
    `nebula3d.io.save_delta_pdf` (and `nebula3d.io.save_mantid_nxs` for
    volumes). `pipeline.write_cell_attrs` is gone;
  - older files still load: `/entry/...` volumes (also the NeXus Viewer's
    hand-off), `/entry/punched`, and root-layout ΔPDFs with `lat_*` attributes.
  An identity UB (unknown) writes no oriented lattice, and neither does a
  left-handed one, which Mantid refuses; NEBULA3D keeps it in its own group.

- **New default ring model, `pooled`: stack-pooled sector profiles.** The
  per-plane `patched` model left a visible residual along every powder ring.
  On measured CORELLI volumes a ring's |Q| position and width wander with
  direction (within one plane, an Al line's peak moves by several |Q| bins),
  and `patched` smooths each |Q| bin's azimuthal pattern with six
  damped harmonics, so it subtracts at the wrong |Q|: a bright arc beside a
  dark one, invisible to the azimuthally averaged removal fraction.
  `fit_pooled_rings` (`ring_model="pooled"`) assumes no radial line shape.
  It reads each plane's median radial profile in 72 azimuthal sectors, pools
  each one with its ±1 neighbouring sectors and the planes within ±5° on the
  ring sphere by weighted median (Bragg peaks, which fill one sector over a
  few planes, are outvoted), and subtracts the SNIP excess inside the
  confirmed shells. Also:
  - a close doublet (the Al 331/420 lines) shares one SNIP window, instead
    of the broad member being half left in the baseline;
  - rings must clear the profile noise (≥ 6σ) as well as 6 % of the strongest
    ring, and a weaker ring is admitted when it sits on an FCC-Al line (the
    weak Al 440 and 533 lines were never subtracted before);
  - the shell envelope is 1.5 × FWHM wide and the amplitude cap 8×, both of
    which clipped real ring before;
  - on a coarse grid the pooling solid angle widens until it holds 12 voxels.

  On the low-temperature dataset the held-out ring residual (RMS, fraction of
  the raw ring) drops by roughly a third to a half at every ring, the doublet
  included. Through the whole pipeline the ΔPDF loses the concentric ring
  ripples: its RMS at 3–10 Å falls on all three datasets, with the back-FFT
  consistency unchanged. Bragg-on-ring inflation is about the same as
  `patched`'s; the subtraction is continuous along the stack axis; the
  stage takes ~52 s serial on a 48 M-voxel volume (`patched` ~45 s) and,
  in low-memory mode, writes in place (~5 B/voxel peak). `ring_model="patched"`
  restores the previous behaviour. The web Configure page gains "Pooled 3D
  sectors" (sectors, stack window) as the default; the run request gains
  `rings_pooled_sectors` and `rings_pooled_window_deg`.
- **Side-by-side ring-model viewer**, `examples/compare_ring_modes.py`: one
  column per model (default `pooled`, `patched`, `parametric`, `global_v2`),
  the cleaned slice above what each removed, a leftover radial profile per
  plane, linked zoom and an H/K/L plane slider. Each model runs once through
  the pipeline path and is cached in `data/processed/ring_modes/`.

- **The Bragg punch now fits each peak's tilt, in Q.** Before this, the
  default pipeline fitted three radii along H, K, L, so no integer peak was
  tilted. The opt-in covariance fit did not follow the data either: it took
  eigenvectors in HKL, floored them at an HKL bounding box, read the core from
  a ±0.2 r.l.u. window (±1 voxel along c* on the measured grid), and used the
  width of the 35 % core, which is 0.61σ for a Gaussian. On measured data,
  almost half the peaks were floored on all three axes, and almost none were
  set by the data on all three. `integer_optimize_shape` is now the covariance fit, in Q (the
  pipeline default):
  - takes the core's covariance in Q (`Σ_Q = UB·C·UBᵀ`), from a window sized
    in Å⁻¹, using only voxels connected to the peak;
  - divides by the Gaussian core-cut factor, so the widths are σ;
  - clips the ellipsoid to contain the punch frame's resolution ellipsoid and
    lie inside `max_radius_scale`× it;
  - leaves peaks whose cut is within `integer_fit_noise_n_mad` (3) noise
    sigmas of the background at the resolution ellipsoid;
  - adds the Å⁻¹ `margin` to the principal radii in Q.

  On synthetic tilted peaks on a measured UB, the punch's long axis is now
  3–16° from the truth, where it was 26–31°. On measured data nearly all
  fitted peaks have at least one axis set by the data, and the measured long
  axes sit well off the spherical frame's φ̂. The default pipeline punches
  somewhat more voxels; in integer mode it leaves less of the strong-peak
  excess outside the punch. `measure_peak_sigmas`
  and `measure_peak_covariance` (the profile's measured widths) use the same
  cut-corrected core, so the width histogram reads 1.65× wider than
  before. The position-only fit takes the same core's centroid. The
  default-punch golden master was regenerated (612 → 489 voxels). Profile
  JSONs from earlier runs predate this change.
- **Removed the diagonal Bragg-shape fit**: three radii along H, K, L, so no
  tilt, floored at an HKL bounding box; the same class of r.l.u. punch as the
  removed HKL frame. `integer_fit_covariance` is gone from `BraggRemover` and
  `PunchParams`, `punch_fit_covariance` from the run request, and the
  Configure page's "Fit tilted ellipsoid" switch with it; "Drop fit
  constraints" stays. Peak records no longer carry `radii_hkl`. A peak where
  the punch frame is undefined (at the origin) still gets the base
  ellipsoid's HKL bounding box. The profile JSON keeps `fit_covariance` (true
  when the shape fit ran) for readers of older profiles.
- **Removed methods with no physical basis.**
  - Generic image inpainting as a backfill: `method="tv"`, `"symmetry"`,
    `"symmetry+tv"` and the `nebula3d.inpainting` package (TV, Laue-symmetry
    copying, RBF, biharmonic). TV assumes a piecewise-constant image and leaves
    staircase artefacts in structured diffuse scattering, and every symmetry
    copy of a punched Bragg node is itself punched. The older ring workflow that
    used it went too: `backfill_ring_shells` (`preprocessing/backfill.py`) and
    `preprocessing/residual_rings.py`. The production ring stage subtracts its
    model, and anything it masks is filled by the Bragg backfill from its own
    surroundings. `backfill_bragg` now takes `local`, `laplace` or `q_shell`, and
    raises on anything else; `BackfillParams` lost `laue_class`, `tv_lam`,
    `tv_iter`.
  - The flatten's `median` and `mode` estimators. A |Q| shell's median or mode
    includes the diffuse signal itself, so subtracting it removes real diffuse
    scattering (the flatten validation found both over-subtract). `floor`
    (default) and `snip` remain.
  - Morphological grey opening as the ring-model baseline
    (`baseline_method="opening"`). It is a shape filter, not a background
    model, and dips below a diffuse background that falls with |Q|. SNIP is now
    the only baseline, so `baseline_method` is gone from `PatchedRadialRingModel`
    and `ParametricRingModel`.
  - Bragg punch radii in fractional HKL (`punch_frame="hkl"`, `punch_radii`,
    `punch_radius_hkl`; `punch_radius_h/k/l` in the run request). The
    resolution is set in Q, so r.l.u. radii depend on the cell and shear on
    oblique axes. The punch is sized in Å⁻¹ only: per peak in the spherical
    frame (the default, now also for `BraggRemover()` and `bragg_mask`) or
    along a*, b*, c* (`"q"`). `punch_frame="hkl"` raises. The `margin` guard
    band is Å⁻¹ everywhere, including the covariance-fit path, which inflated
    by r.l.u. outside the `"q"` frame. The default direct-beam punch, when no
    beam radii are set, is twice the Bragg punch's HKL bounding box. The
    default pipeline punch is unchanged: the same mask on a measured
    volume. `examples/compare_punch_frames.py` and `plot_punch_slices.py`
    (HKL vs Q comparisons) were removed, and the punch examples take
    `SPHERICAL_R` (Å⁻¹) instead of `R_HKL`.

  The Configure page no longer offers the removed options. Docs, examples and
  the manual source follow.
- **The edge of the measured coverage is trimmed at load, on by default.** A
  measured voxel next to unmeasured space is barely normalised. On a
  hexagonal 401³ TOPAZ volume those voxels reach values orders of magnitude
  above the interior, while one voxel further in they match it. They went
  straight into the ΔPDF, and as Laplace boundary
  values they lit up the holes next to them. The pipeline now takes
  `PipelineParams.edge_trim` layers (default 1; 0 keeps them) off the measured
  coverage when it loads the raw input: those voxels become unmeasured, masked
  and zeroed as the loader leaves unmeasured voxels, and the run log says how
  many. The volume's own faces are not an edge. A fully measured volume
  loses only a few thousand of tens of millions of voxels; the hexagonal
  TOPAZ volume loses millions, and its default punch then finds less than
  half as many peaks (most of the rest were edge voxels), punching about half
  as many voxels. Existing
  outputs are not recomputed by themselves: re-run from the ring stage.
  `nebula3d.preprocessing.trim_coverage_edge`, `nebula3d.pipeline.load_input`,
  `edge_trim` in the run request (+ tests).
- **Backfill: each punched hole is filled from its own surroundings.** The
  backfill took every masked voxel for a hole, so a punched hole that touched
  unmeasured coverage merged with it, and the whole region (coverage and every
  hole touching it) got one fill value set by the coverage's rim. On a
  hexagonal 401³ TOPAZ volume, mostly unmeasured, that was most of the
  punched voxels, which showed as flat discs that did not match the data
  around them.
  The punch stage now records which voxels it punched, in memory and as
  `/entry/punched` in `*_braggpunched.h5`, and `backfill_bragg(punched=…)`
  fills each hole only from the measured voxels around it. The coverage is
  filled separately afterwards, with its own shell median. For `laplace`,
  unmeasured neighbours are a free (Neumann) boundary. On that volume, the
  holes whose mean fill is more than 3 MAD from the median of the measured
  voxels within 2 voxels of them drop from a few per cent to none (`local`),
  and the median offset shrinks. A punch artifact written before this change has no record:
  the backfill says so in the run log and fills as before. Re-run the punch to
  fix it. `src/nebula3d/analysis/bragg_fill.py`, `src/nebula3d/pipeline.py`
  (+ tests).
- **Desktop browsers: large volumes no longer run out of memory in the
  backfill.** A 401³ TOPAZ volume (64.5 M voxels, inside the ~80 M-voxel
  limit) failed in the browser with a `MemoryError` in the backfill. Four steps
  each built a full float64 |Q| grid with its temporaries, ~25–40 B/voxel on
  top of the volume: the cross-plane ring confirmation, the punch's per-|Q|-shell
  thresholds, the radial flatten and, on that volume, the direct-beam fill. Its
  unmeasured coverage (most of the cube) reaches the origin, so the direct-beam
  fill took all of it for the beam. The first three now compute |Q| one plane
  or one 16-plane slab at a time, with identical values. The direct-beam fill
  leaves an origin region whose bounding box is over 2 M voxels (a real beam's
  is ~2,000) to the generic fill. On the TOPAZ volume the old beam fill found
  no clean shell there and filled nothing, so every stage output is
  byte-identical, as it is on a fully measured 48.4 M-voxel volume. The Laplace
  fill also frees its unknown lists for an oversized region before filling it
  locally (same output). Under Pyodide 0.27.7 the WASM heap now peaks at
  2.8 GiB on the TOPAZ volume (it failed at 3.8 GiB; 2.9 GiB with
  `method="laplace"`), 2.1 GiB on the 48.4 M-voxel volume (was 2.5 GiB) and
  2.9 GiB on a fully measured 79.5 M-voxel volume at the limit (the old code
  hit the 4 GiB ceiling there), out of 4 GiB.
  `src/nebula3d/preprocessing/radial_background.py`,
  `src/nebula3d/analysis/bragg.py`, `src/nebula3d/analysis/bragg_fill.py`,
  `src/nebula3d/preprocessing/radial_flatten.py`, `tests/test_memory_peaks.py`.
- **Phones and tablets: a size limit that fits the device.** Loaded volumes
  (**Load volume…** and the NeXus Viewer import) were checked only against
  the desktop budget of ~80 M voxels, so a phone accepted volumes that the OS
  would kill the tab over mid-run. On a phone or tablet the gate now budgets
  the whole tab: ~0.55 GB of runtime + packages plus 150 B/voxel (measured
  ~125 B/voxel on a full demo run, plus room for a Mantid input's float64
  signal and errors) against 1.3 GB, i.e. up to ~5 M voxels (≈ 171³; the demo
  is 4.2 M). A larger file is refused before it loads, with a message that
  points to a desktop browser (up to ~80 M voxels) or the native build.
  Desktops are unchanged. The page detects the device (`web/src/api/device.ts`,
  now shared with the ring pool) and sends it in the pipeline worker's boot
  message to `webbridge.setup(mobile=…)`, because only the main thread can tell
  iPadOS from a Mac. `inspect_input` reports `device`.
  `src/nebula3d/webbridge.py`, `web/src/api/pyodideEngine.ts`,
  `web/src/workers/pyodideWorker.ts` (+ tests).
- **iPhone / iPad: the in-browser run no longer reloads the page mid-run.**
  On iOS every browser is WebKit, which runs all of a page's workers inside one
  content process. The OS kills that process at a memory limit far below a
  desktop's, and Safari then silently reloads the page. The ring-worker pool
  sized itself as `min(4, hardwareConcurrency − 2)`, and WebKit reports 4 on an
  iPhone, so it added two extra Pyodide + numpy/scipy instances (~0.45 GB
  resident each, measured) to the pipeline worker. With the 161³ demo that
  took a run past the limit. Phones and tablets (iOS, iPadOS — which sends a
  desktop-Mac user agent, so it is caught by its touch points — and Android)
  now get no ring workers. The ring stage runs serially in the pipeline worker
  instead, with bit-identical output. The `nebula3d.ringWorkers` localStorage
  setting still overrides. `web/src/api/ringPool.ts`, `web/src/api/device.ts`
  (`isMobileDevice`, + tests).
- **The demo volume is labelled synthetic and costs less memory.** The file
  and dataset are now `synthetic_rocksalt` (was `demo_rocksalt`), and the
  Configure page says it is simulated, not measured data. It is stored float32,
  which is what the browser computes in, so its in-memory file halves
  (52 → 23 MB). `demo_volume` draws the counting noise one H plane at a time, in
  place (`dtype=` sets the storage precision). Generating 161³ then peaks at
  ~76 MB of arrays instead of ~220 MB, below the ring stage's ~195 MB, so the
  demo no longer sets the WASM heap's high-water mark (measured under Pyodide
  0.27.7: 179 MB after generation, was 325 MB). Measured under Node, a full
  demo run's pipeline worker is ~1.07 GB resident (was ~1.27 GB). On a phone it
  no longer carries two ring workers of ~0.45 GB each, so the total is roughly
  half.
  `src/nebula3d/demo.py`, `src/nebula3d/webbridge.py`, `tests/test_webbridge.py`.
- **New demo volume: finer grid, physical diffuse scattering.** **Use demo**
  loads a 161³ volume (was 33³) over ±4 r.l.u., step 0.05 r.l.u. (0.075 Å⁻¹).
  That is fine enough for resolution-limited Bragg peaks and a 0.5 Å ΔPDF
  grid, and the full chain still runs in about 5 s in the browser. The crystal
  is rock-salt-type (cubic, a = 4.2 Å, FCC lattice), on the intensity scale of
  a normalised Mantid volume (Bragg up to ~150, diffuse ~0.1–0.5), with three
  kinds of diffuse scattering, each with a known 3D-ΔPDF signature:
  - chemical short-range order (Krivoglaz–Clapp–Moss, V2/V1 = 0.3): maxima at
    (1 ½ 0); in the ΔPDF, negative at ⟨½ ½ 0⟩a and positive at ⟨1 ½ ½⟩a and
    ⟨2 0 0⟩a;
  - one-phonon thermal diffuse scattering of a nearest-neighbour FCC lattice
    (Q·D⁻¹·Q): halos at every node, growing as |Q|², streaking along ⟨110⟩;
  - 2-D order in the (001) layers: rods along L at (h+½, k+½), a checkerboard
    confined to the z = 0 plane in the ΔPDF.

  Also in the volume: FCC Bragg peaks with a |Q|-dependent resolution ellipsoid
  and Debye–Waller falloff, a radial background, a compact incident-beam spot,
  aluminium-can powder rings at the Al d-spacings with texture about c*,
  Poisson counting noise, and a matching per-voxel `sigma`. On the old demo,
  whose Bragg peaks were ~10× the diffuse and smaller than a voxel, the default
  punch reported 114 peaks and only 34 of them were at FCC nodes; the rest were
  noise at high |Q|. On the new one it finds only FCC nodes, and every diffuse
  maximum sits off the integer nodes so none is punched. The ΔPDF reproduces
  the ground truth of the planted diffuse (r = 0.91). The generator is `nebula3d.demo.demo_volume`,
  built in slabs so its temporaries stay small in the WASM heap. It can return
  any single component without noise, and `webbridge.make_demo_input` writes
  it as `synthetic_rocksalt`. `tests/test_demo.py` pins the physics and the
  end-to-end result. The absolute consistency-r floor in
  `tests/test_float32_equivalence.py` drops from 0.999 to 0.98, because the
  demo's counting noise caps r at ~0.992. The float32/float64 gates are
  unchanged. See `docs/web.md` ("Demo volume").
- **Layouts for iPhone, iPad, MacBook and 4K screens.** Below 1100 px (iPad
  Pro portrait and all iPhones) the sidebar becomes a compact top bar with a
  scrolling row of view pills. On phones this bar is a single row in landscape.
  Viewer panels no longer squeeze into one row there: they wrap into a grid, or
  stack one per row on a phone. Stat strips, headers, clusters and the Bragg
  peak table reflow instead of overflowing. On 4K at 150 %, Configure shows the
  workflow controls and the live preview side by side. On a 4K panel at 100 %,
  the console is scaled up. Touch screens get finger-sized controls, the shell
  uses the dynamic viewport height and safe-area insets, and phones get 16 px
  form text (no zoom on focus). Configure fields no longer spill out of their
  boxes on iPad widths. Long file names, run IDs and slider readouts wrap
  instead of being cut off. The AI Assistant page grows when its settings
  drawer is open, instead of running under the page footer. Checked at every
  target size (with iPhone safe areas emulated) for overlapping components
  and cut-off text. `web/src/index.css` ("Device layouts"),
  `web/src/App.tsx`, `web/index.html`; see `docs/web.md`.
- **NeXus Viewer import shows its progress.** While NEBULA3D waits for the
  volume, the viewer sends `nebula3d-import-progress` (stage label + overall
  fraction), and the import banner shows it as text and a progress bar instead
  of only "Waiting for the NeXus Viewer…". Once the file arrives, the banner
  shows the in-browser engine's start-up step and bar while it boots, instead of
  a bare "Loading…". The message is optional: older versions of either app
  ignore it or never send it. The Configure page's boot panel and the banner now
  share `bootPercent` (`api/pyodideEngine.ts`) and `useBootStatus`
  (`api/hooks.ts`). `web/src/api/importHandoff.ts` (`onProgress`, + test),
  `web/src/components/ViewerImportBanner.tsx`; see `docs/web.md`.
- **NeXus Viewer import: the two tabs no longer share a browser process.** The
  viewer opened this app with a window reference. Same-site tabs linked that way
  share one renderer process and main thread, so reloading, closing or crashing
  the viewer could also end a pipeline run here. A viewer on this app's origin
  now opens the tab with `noopener` and exchanges the same messages over the
  `BroadcastChannel` `nebula3d-import:<id>`. This app listens on the channel and
  on `window.opener`, so an older viewer and cross-origin dev servers still
  work. `web/src/api/importHandoff.ts` (+ tests); needs the matching
  neutron-nexus-viewer change; see `docs/web.md`.
- **Bragg backfill now fills from the diffuse around each hole.** The pipeline,
  `run_pipeline.py` and web default changes from `q_shell` to `local`.
  `q_shell` filled every hole with the median of its whole |Q| shell. That is
  biased at the lattice nodes, where correlations at lattice-vector separations
  peak or dip, and the node-periodic bias Fourier-transforms into spurious ΔPDF
  features at the lattice vectors. The standard punch-and-fill practice
  (NXRefine, Mantid `DeltaPDF3D`, KAREN) interpolates the surrounding diffuse.
  **Re-run backfill → ΔPDF on existing datasets: results change.**
  - **New `method="laplace"`:** a harmonic (Laplace) fill of all holes in one
    sparse system (Jacobi-preconditioned CG, no per-hole loop), continuing the
    local diffuse smoothly with no edge step. Its boundary sits `laplace_gap`
    (default 1) voxels outside the punch, so Bragg tails leaking past the punch
    do not pull the fill up; measured voxels in that band are kept. Exposed in
    `BackfillParams.laplace_gap`, the web method menu and `LAPLACE_GAP` in
    `examples/backfill_bragg_3d.py`.
  - **Synthetic check** (short-range order + node-peaked diffuse + Bragg):
    worst lattice-vector ΔPDF artefact ~2.3 % of the signal for `q_shell`,
    ~1 % for `local`, ~0.8 % for `laplace`. Backfill transient memory on a
    25 M-voxel volume: `q_shell` 41, `local` 25, `laplace` 35 B/voxel.
  - `q_shell` stays available for comparison. The web help text no longer
    claims it "interpolates".

- **3D-ΔPDF on non-orthogonal cells: true distances and real section angles.**
  The ΔPDF grid is unchanged (native FFT grid, `x_H/y_K/z_L` in Å along a, b,
  c), but the cell angles now travel with it. They are stored as
  `DeltaPDF.cell_angles` and as `lat_alpha/beta/gamma` in the `.h5` attrs (via a
  shared `pipeline.write_cell_attrs`). They are exposed as `alpha/beta/gamma` in
  the volume, ΔPDF and consistency lattice metadata, and sent with every ΔPDF
  slice (`axes_angle`, `r_center`, `r_perp`).
  - **True distances:** new `real_space_radius` and `section_geometry` in
    `nebula3d.analysis.delta_pdf`. The consistency r band and `r_data_max`
    now use the true metric; this is bit-identical for 90° cells.
  - **Web viewers** (3D-ΔPDF, multi-temperature, Q–R band) draw each section at
    γ/β/α. Unit-cell lines follow the lattice, and r-band circles are placed by
    true distance. The assistant's ΔPDF metrics and context use Cartesian
    positions and include the angles.
  - **matplotlib viewers** (`explore_delta_pdf_ortho.py`,
    `explore_delta_pdf.py`, `explore_delta_pdf_multi.py`) apply the same skew.
    This also fixes the ortho and multi viewers, which had crashed since the
    June rename on leftover `TEMP` / `central[t]` names.
  - **Older files** without angle attrs are drawn at 90° as before.
  - **`ub_from_lattice` fixed.** It returned a singular matrix for every cell;
    it now builds the Busing–Levy B matrix, and new `direct_cell(ub)` inverts it.
  - **Tests:** `tests/test_nonorthogonal_cells.py`, `tests/test_server.py` and
    `web/src/components/__tests__/oblique.test.ts` pin this on orthorhombic,
    hexagonal, monoclinic and triclinic cells.

- **Import from the NeXus Viewer.** The viewer's *Open in NEBULA3D* button
  opens this app with `?import=nexus-viewer&id=…&from=…` and posts its
  symmetrized, masked volume (nebula3d HDF5, padded symmetric about Q = 0)
  once the page reports ready; the in-browser build loads it like *Load
  volume…*, selects it as the dataset and reports back. Messages are exchanged
  only with `window.opener` at an allowed origin (own, drthyang.github.io,
  localhost in dev). `web/src/api/importHandoff.ts` (+ vitest suite),
  `web/src/components/ViewerImportBanner.tsx`; see `docs/web.md`.
- **Mantid loader: projection guard for non-orthogonal cells.** Each dim's
  `long_name` is now read as an (h, k, l) direction (`[-K,2K,0]` → (−1, 2, 0))
  and cross-checked against the `W_MATRIX` log. Only plain H, K, L axes (in any
  order) load; a projected grid such as the orthogonal hexagonal cut
  `[H,0,0]/[-K,2K,0]/[0,0,L]` is rejected with a rebinning hint instead of
  loading with silently wrong |Q| (the old parser took the first H/K/L letter
  in the label). Loads of existing orthorhombic files are bit-identical.
  `tests/test_nonorthogonal_cells.py` pins the guard plus metric-correct ring
  removal and ΔPDF peak placement on hexagonal (γ = 120°) and monoclinic
  (β = 110°) cells.
- **Build & CI hardening.** The packaged wheel no longer nests a stale copy of
  the Pyodide wheel inside itself (`vite build` copied `web/public/wheels`
  into `server/static/`, and `package-data` shipped it: 1.35 MB of
  Russian-doll wheels vs ~230 KB clean); `exclude-package-data` now drops
  `static/data` + `static/wheels` from every wheel, the native build no
  longer copies `web/public`, and one shared `scripts/build_web_wheel.py`
  (Makefile + Pages workflow) inspects the wheel and publishes it
  content-addressed under `wheels/<sha256>/` so a redeploy can never serve a
  Pages-cached stale wheel. The browser boot drops matplotlib (~9 MB of
  wheels it loaded only to render a `pdf_check` PNG nothing reads). Pages now
  deploys only after the CI workflow passes on `main`; CI type-checks once
  against pinned numpy/mypy stubs (per-Python stub drift had kept `main` red
  since July), runs the suite under the exact numpy/scipy/h5py/matplotlib
  Pyodide 0.27.7 ships, builds both frontend modes, and reports every matrix
  leg. Also: the package version is read from `_version.py` only, coverage
  moved from pytest `addopts` to the CI command (~40 % faster local runs),
  `httpx2` replaces `httpx` for the Starlette test client, matplotlib
  `set_bad` → `with_extremes`, and a CSS comment containing `*/` that had
  silently disabled the `.bragg-page` flex rule is fixed.
- **Browser engine: parallel ring removal, float32 compute, WebGPU ΔPDF.** The
  static (Pages/Pyodide) build now fans the ring stage out over a pool of slim
  Pyodide ring workers (bit-identical to serial by construction — the pure
  per-plane core in `nebula3d._ringplane` is shared by every backend; pinned by
  `tests/test_ring_parallel.py`), computes with float32 volume storage
  (`PipelineParams.precision`; axes/UB, |Q|-bin decisions, 1-D fits, and large
  reductions stay float64 — validated on three measured 48.4 M-voxel volumes
  at ΔPDF nrms ≤ 1e-5 with ≤ 2 punch-mask flips per volume, ~15–25 %
  faster), and runs the ΔPDF forward/inverse FFT cores on WebGPU when available
  (`web/src/gpu/` mixed-radix Stockham with numpy-pinned index math; scipy
  fallback at every rung; `fft=webgpu-f32-p5` cache token). The admission gate
  rises from ~50 M to **~80 M voxels** (401³ volumes now run in-browser).
  Plus: streaming consistency metrics and per-plane deapodization (bit-exact,
  ~30 B/voxel off the old peak stage), wheel-manifest boot (no hardcoded
  version), lazy `nebula3d.visualization` import, MEMFS upload-leak fix, and
  workers moved to ES modules (`pyodide.mjs`). Native float64 runs are
  hash-verified bit-identical to the previous release.
  See `docs/reports/2026-08-07_browser_parallel_f32_webgpu.md`.
- **Ring Removal 2.0 — sample-only global 3D powder-shell inference.** Added the
  opt-in `ring_model="global_v2"` path for datasets where an empty-environment
  scan omits the Al holder or over-subtracts. It detects narrow shells in the
  unsubtracted 3D sample volume, weakly identifies the FCC Al family and fitted
  lattice parameter, fits a Bragg-robust real-spherical-harmonic angular field,
  propagates model uncertainty, and defaults to lower-confidence-bound
  subtraction. `auto`, `aluminum`, and material-agnostic modes plus
  conservative/mean/diagnose-only policies are exposed in Python, API, Pyodide,
  and Configure UI. Pipeline runs write a JSON diagnostic sidecar. Legacy
  patched/parametric models remain available and the default pending full
  real-data qualification.
- **The backfill no longer invents data outside the measured coverage.** It
  filled every masked voxel, so on a hexagonal dataset the large part of the
  box past the coverage sphere got its rim's shell median, which then entered
  the flatten fit, the ΔPDF, the back-FFT check and the viewers. The fill now
  interpolates and never extrapolates: punch holes, and unmeasured pockets that
  measured data enclose (the direct-beam shadow, dead voxels), are filled as
  before; unmeasured regions that reach a face of the box stay masked.
  `BackfillParams.unmeasured="all"` restores the old fill. See
  docs/algorithms/inpainting.md.
- **The 3D-ΔPDF window respects the lattice symmetry and the measured
  coverage.** The separable window (a product of 1-D tapers along H, K, L) is
  not invariant under the hexagonal 6-fold, so on a hexagonal (6/m) dataset
  the ΔPDF along a and b differed from a + b by a few per cent of the main
  peak. New `window_shape`
  (`auto` | `separable` | `ellipsoid`; server `pdf_window_shape`, and a web
  control): `auto` tapers hexagonal cells on the largest symmetric ellipsoid
  inside the box, and keeps the separable window bit for bit for orthogonal,
  monoclinic and triclinic cells. New `support=` (pipeline `window_support`,
  default on; web "Taper to the measured coverage"): masked voxels enter as
  ΔI = 0 and the mean is taken over the data only; where the coverage ends
  inside the box, the ellipsoid shrinks until at most 10⁻³ of its weight lies on
  unmeasured space. With the backfill now leaving that space masked, the
  hexagonal data change by well under a per cent at 2–15 Å. Cached ΔPDFs are
  recomputed once. See
  docs/algorithms/delta_pdf.md.
- **The Bragg punch and the edge trim follow the declared Laue symmetry.** On a
  symmetrised volume (e.g. 6/m from the NeXus Viewer), the punch mask and the
  coverage-edge trim are now invariant under the operations the file declares
  (`PipelineParams.symmetry="auto"`): a voxel punched at one equivalent position
  is punched at all of them. On the hexagonal data, a sizeable fraction of
  punched voxels had an unpunched partner; now none. The H guard and the thirds exclusion hold on every
  equivalent plane, so with 6/m the guard is a hexagonal prism.
  `symmetry=None` restores the old behaviour. See
  docs/algorithms/bragg_cleanup.md.

## 0.3.0 (beta) — 2026-07-05

First beta. Adds an in-browser AI Assistant, a sidebar UI refresh, and the
low-memory + performance work below.

- **AI Assistant — grade the reduction from computed metrics.** A new browser
  view (`web/src/llm/`) connects to a local (Ollama / LM Studio) or cloud
  (OpenAI / Gemini) model and assesses the reduction, grounded in numeric
  metrics computed **in the browser** from the stage volumes — ring-removal
  residual energy, a leftover-Bragg-peak scan plus fitted peak-profile summary,
  backfill seam / checkerboard diagnostics, and ΔPDF feature SNR / anisotropy /
  radial trend. Four one-click stage reviews plus free chat; a ChatGPT-style
  transcript with markdown + LaTeX-Greek rendering, a rotating "sun" avatar, and
  collapsible model reasoning; an optional vision toggle that attaches the
  rendered slice for image-capable models. Everything is client-side — nothing
  leaves the machine except the chat call to the user's configured model server.
  The metrics layer is unit-tested (Vitest). Fixed a stack-overflow in the ΔPDF
  metrics on full-resolution slices along the way.
- **Sidebar UI refresh.** A single global dataset switcher lives in the sidebar
  (per-page dataset pickers removed; Configure shows it read-only); the chat
  session persists across page navigation; the brand is set full-caps; and the
  Multi-volume view is hidden for now. The browser build keeps full feature
  parity with the native backend.
- **In-browser low-memory mode — smaller peak, bit-identical results.** A new
  `NEBULA3D_LOW_MEMORY` mode (`nebula3d.core.low_memory`, always on in the
  Pyodide bridge) trades a little recompute for a smaller peak so full-resolution
  reductions fit the 4 GB WASM heap (Pyodide is 32-bit; there is no wasm64
  build). The ring stage drops its full-3-D |Q|/φ coordinate caches (per-plane
  2-D recompute), the flatten stage subtracts in place, and the unused per-voxel
  `sigma` is freed before the ΔPDF / back-FFT stages. **Verified byte-for-byte
  identical to the exact path on real data** — a 401×501×151 (30.3 M-voxel)
  neutron dataset gives identical backfilled / flattened / ΔPDF volumes and
  identical consistency metrics either way; the whole reduction peaks at ~2.3 GB
  (binding stage: the back-FFT consistency check, ~75 B/voxel). Separately, the
  ring-workflow `backfill_ring_shells` (not the default `q_shell` Bragg backfill)
  now bounds its all-valid-voxel KD-tree to a per-H-slab local tree in
  low-memory mode — within ~1e-5 relative of the exact fill, tested in
  `tests/test_backfill_blocked.py`. 222 tests, ruff, and mypy clean.
- **Pipeline ~22–31 % faster with bit-identical outputs.** Browser audit +
  performance pass (see
  [docs/reports/2026-07-02_browser_audit_perf.md](docs/reports/2026-07-02_browser_audit_perf.md)):
  HDF5 stage outputs now use gzip-1 + byte-shuffle (lossless, ~8 % smaller,
  ~2.6× faster writes), consecutive pipeline stages hand volumes over in
  memory instead of re-reading compressed HDF5 (artifacts and resume
  behaviour unchanged), and the ring-removal texture fit solves its per-|Q|
  ridge systems in one stacked LAPACK call. Every stage artifact verified
  SHA-256-identical before/after at two volume sizes, serial and parallel;
  219 tests, ruff, and mypy clean; in-browser end-to-end run verified
  (6/6 stages, consistency check near-exact, no console errors).
- **Milestone: fully static, GitHub Pages-hosted app with feature parity.** The
  browser console now runs the **complete** `nebula3d` reduction — every pipeline
  stage, cleanup, 3D-ΔPDF, multi-volume, and consistency view — entirely
  client-side via Pyodide, at **full-resolution float64** (up to ~50 M voxels;
  a 301×401×401 volume fits). No server, no upload, no install: the app is a
  static bundle served from **https://drthyang.github.io/nebula3d/**, deployed by
  `.github/workflows/pages.yml` on push to `main`. The in-browser build is now a
  first-class path alongside the native `nebula3d-web` backend, not a reduced
  demo. Under Pyodide (no OS threads) ring removal falls back to serial slice
  processing; native CPython still parallelises.
- **Spherical-frame Bragg punch.** The default punch ellipsoid axes now follow
  the local spherical frame at each peak — `(rρ, rθ, rφ)` in Å⁻¹ with rρ radial
  (along Q̂), rφ azimuthal (a*–b* ring tangent, c* pole), rθ polar — so every
  reflection is oriented correctly with no tilt angle. Added
  `punch_frame="spherical"` (now the `PunchParams` / web default) alongside the
  existing `"q"` (a*/b*/c*) and `"hkl"` frames; the legacy frames are unchanged.
  Configure and Bragg-profile pages gain a frame selector and rρ/rθ/rφ controls,
  and the punch preview renders the per-peak oriented ellipse.

## 0.2.0 - 2026-06-18

- Promoted the consistency check to the endpoint of the recommended 3D-ΔPDF
  workflow.
- Added the FastAPI/React consistency viewer and `/api/consistency` endpoints
  for reciprocal-space back-FFT comparison with optional `|Q|` and real-space
  bands.
- Updated `examples/run_pipeline.py` to run the back-FFT consistency check by
  default after the ΔPDF stage.
- Updated documentation around the full workflow, web UI, reproducibility
  commands, and output artifacts.
- Aligned package, API, and web app version metadata at `0.2.0`.

## 0.1.0 - Initial alpha

- Initial alpha toolkit for reciprocal-space diffuse-scattering cleanup and
  3D-ΔPDF exploration.
