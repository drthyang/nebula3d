- **Fixed: the console no longer freezes or waits forever.** Four causes, each
  reproduced: (1) the NEBULA Pilot chat blocked the page for seconds on every
  reply once the conversation was long (40 earlier replies: 11 s of blocking per
  question, the longest freeze 4.8 s), because the saved transcript was written
  out once per turn it dropped, and every streamed piece of a reply re-rendered
  every earlier turn. Each turn's JSON is now written once, earlier turns render
  once, and a step's result is put on the page only when it is opened; the same
  question now blocks the page for at most about 0.1 s. (2) A native run whose
  worker process died without a word (killed by the system for memory, or
  crashed) stayed "running" forever, with its page and the Pilot waiting on it;
  the job now fails within a second or two, saying how the process ended, and
  the run's page shows why. (3) A tuning run's request to a model server that
  went quiet waited forever; it is now streamed under the chat's stall limits
  (nothing for 5 minutes before the reply, or 2 minutes within it); a stalled
  request is asked once more after a 5 s pause, as the chat does, and a second
  stall ends the tuning run with the reason. Stop ends it at once, without
  asking again. (4) See the Execution page's fix for a run
  whose progress stream drops.
