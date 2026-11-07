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
  - **From amber** it offers **Summarize and continue** and **Start fresh**.
    Start fresh clears the conversation. Summarize and continue is offered
    only where it makes the request shorter.
  - **Summarize and continue** sends the model the app's own summary of the
    turns so far instead of their text. The summary lists each question,
    the checks its reply ran and the app's verdict then, and the decisions
    on the Apply cards. No model writes it, so it costs nothing, and it
    holds no measured number. The chat says where the summary took over,
    and shows what the model reads. The transcript keeps every turn.
  - **Nothing is dropped silently.** The model reads the newest 8 turns as
    text. Where earlier turns are no longer sent, the chat now says so.
  - **On a phone** the meter stays hidden until amber. Its actions are 44 px
    taps on one row.
  - While an auto run is under way or paused, the meter is hidden: the Auto
    panel counts that run's tokens.
