- **NEBULA Pilot shows its token usage.** Under each reply: the tokens its
  model requests read and wrote, and the part read from (or written to) a
  prompt cache when the server says; in the chat's footer, the conversation's
  total, tuning requests included (hover for the details). Every request now
  asks its server for the counts (OpenAI-compatible servers report them only
  when asked; OpenAI's cached prompt tokens are read too); a server that
  refuses the first request asking for them, in whatever words, is asked again
  without them, and from then on is not asked. A request whose
  server reports none is counted by the console's estimate and marked ≈,
  "estimated", never passed off as a count. A request that was sent but did not
  complete (stopped, failed, or asked again after a stall, a crash or a reply
  its server could not parse) has no counts, and is said apart: "+1 request
  not counted", next to the reply's count and the conversation's total. The totals stay with the conversation (a reload, a saved session)
  and start again on Clear.
