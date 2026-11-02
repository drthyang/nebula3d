- **A local model with Tools needs a 32k context, down from 56k.** Since the
  leaner Pilot context (THY-63), the worst assessment is about 26k tokens with
  room for the reply, so a 32,768-token window holds it with nothing shortened
  and 3k to spare. The setup hints, the overflow and cut-off notes and the
  LM Studio warning now suggest 32k (32768), and the evals' run policy accepts
  a local live run at 32k; a smaller window is still refused, with how to load
  the model with more.
