- **NEBULA Pilot: a context meter by the chat box.** "Context 62%" replaces
  the token count in the toggles row. It shows how much of the model's
  context window the next question would take, with the room kept for the
  reply.
  - **The window is the model's own.** On Ollama and LM Studio it is the 32k
    that Tools need, or the length LM Studio loaded the model with. On Claude
    it is the model's own window: 1M, or 200k for older models. The room for
    the reply is 6,144 tokens on a local model, and the 64,000-token output
    cap on Claude. For another cloud model the window is not known, so the
    meter shows only the token count.
  - **Colours.** Neutral below 70 %, amber from 70 % to 90 %, red above 90 %.
  - **The "?"** opens one plain line: the tokens used of the window, the
    room kept for the reply, and on Claude what the conversation has cost.
  - **From amber** it offers one action beside it: **Summarize and
    continue** where that makes the request shorter, else **Start fresh**,
    which clears the conversation. Where Summarize is offered, Start fresh
    is in the "?" line.
  - **Summarize and continue** sends the model the app's own summary of the
    turns so far instead of their text. The summary lists each question,
    the checks its reply ran and the app's verdict then, and the decisions
    on the Apply cards. No model writes it, so it costs nothing, and it
    holds no measured number. The chat says where the summary took over,
    and shows what the model reads. The transcript keeps every turn.
  - **Nothing is dropped silently.** The chat now says so in three cases:
    - The model reads the newest 8 turns as text. Where earlier turns are
      no longer sent, the chat says so.
    - A reload can leave the oldest turns out, because the tab keeps about
      1 MB of the conversation. The chat says how many were left out.
    - A session file keeps no summary. After a restore, the chat says the
      model reads the turns again, the newest 8 of them.
  - **On a phone** the meter stays hidden until amber. Then its action takes
    the bar's place, with a short label, as a 44 px tap. The dock grows by
    no row, so the composer stays in view when the sheet is low.
  - While an auto run is under way or paused, the meter is hidden: the Auto
    panel counts that run's tokens.
