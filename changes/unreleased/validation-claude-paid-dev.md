- **Validation runner: Claude Haiku 5.5, the dev split for Claude, and one
  $40 ledger (THY-52, 2026-11-07).** Not model-visible.
  - `claude-haiku-5-5` joins the validation's models, on the dev split only,
    for breadth; Sonnet 5.5 may run the dev split too, to confirm Haiku's
    failures. The test split stays sealed.
  - The two Claude models share one spend ledger, capped at $40 in code
    (`NEBULA_VALIDATION_ALLOW_SPEND=40`), with the reserve rule kept.
    `NEBULA_VALIDATION_LEDGER` names the ledger's file and
    `NEBULA_VALIDATION_SPEND_STOP` stops a plan below the cap.
  - Sonnet 5.5's cache-read price is $0.20 a million tokens, as `auto/cost.ts`
    has it, not $0.10.
