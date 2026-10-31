- **A memory bar in the sidebar.** Under the API status (at the end of each
  page on a phone): memory used against a ceiling, the share in percent, amber
  from 75 % and red from 90 %, and a tooltip saying what is measured. In the
  in-browser build it is the pipeline worker's WASM heap against Pyodide's
  4 GiB ceiling, a high-water mark, since the heap never shrinks; the ring
  workers' heaps are listed in the tooltip. On a phone or tablet it is every
  worker's heap against the 1.3 GB tab budget the size gate plans with, shown
  as a lower bound (`≥`, "heaps only"), because the tab holds more than its
  heaps. The workers report their heaps themselves when they grow, so nothing
  polls them. In the native console it is the server and its running pipeline
  processes against the machine's RAM: RSS on Linux, the physical footprint on
  macOS, nothing elsewhere. A new endpoint, `GET /api/memory`, reports it,
  with the standard library only (psutil is not a dependency). The bar only
  reports: the free room inside a high-water heap can't be measured, so it
  gives no pre-run warning beyond the size gate's refusal at load. See
  [docs/web.md](docs/web.md#memory-bar).
