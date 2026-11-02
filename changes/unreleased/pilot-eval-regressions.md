- **NEBULA Pilot no longer changes the ring removal on one cut's bumps.** A
  ring setting changes, and the rings are tuned, only once `assess_stage`'s 3D
  ring verdict finds a ring left or dented on the current outputs, or when your
  message names the change. The cut tool's glossary now says its ring residuals
  are no ring verdict, since the crystal's own scattering makes them too. A free
  local eval had seen a model remove a crystal's own diffuse shell this way.
- **An answer kept although it failed its checks is marked.** When the model's
  revision writes nothing in its place, the lines that hold unsupported claims
  carry a ⚠ and the note under the reply quotes them. ΔPDF features written in
  LaTeX (`\Delta\text{PDF}`, `\text{Å}`) now count as claims that need
  `dpdf_peaks`.
- **`qmax_coverage` says what `counts_end_inside_box` means:** true when the
  counts stop before the box's face. A model had read `false` as the opposite.
