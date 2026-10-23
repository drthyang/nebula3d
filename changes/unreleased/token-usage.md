- **NEBULA Pilot shows its token usage.** Under each reply: the tokens its
  model requests read and wrote, and the part read from (or written to) a
  prompt cache when the server says; in the chat's footer, the conversation's
  total, tuning requests included (hover for the details). Every request now
  asks its server for the counts (OpenAI-compatible servers report them only
  when asked; OpenAI's cached prompt tokens are read too). A request whose
  server reports none is counted by the console's estimate and marked ≈,
  "estimated", never passed off as a count; failed or stopped requests are not
  counted. The totals stay with the conversation (a reload, a saved session)
  and start again on Clear.
