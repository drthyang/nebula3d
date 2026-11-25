- **Fix: a sent-back answer's revision can no longer run on for minutes.** When
  an answer fails its checks it goes back to the model once, and the revision
  only has to drop or correct claims. On gemma4:26b a revision sometimes ran to
  the 16,000-token output cap, about five minutes, before it was cut (THY-84).
  The revision now asks for its own output cap, twice the length of the answer
  it revises and at least 4,096 tokens, never more than the reply's own cap, and
  it is stopped when its text or its thinking starts repeating itself. Either
  way the answer it revised stands, with its unsupported claims marked, as when
  a revision is cut today. A revision stopped for repeating itself says so
  under the reply. Nothing the model reads changes.
