// The pipeline store follows a run's progress over Server-Sent Events, and
// Node (where the validation runs) has no EventSource. This one reads the
// stream with fetch, which useBackend() points at the server, and calls
// onmessage with each event's data as a browser's would.

type Listener = (e: { data: string }) => void;

export class FetchEventSource {
  onmessage: Listener | null = null;
  onerror: (() => void) | null = null;
  private readonly abort = new AbortController();

  constructor(readonly url: string) {
    void this.pump();
  }

  close(): void {
    this.abort.abort();
  }

  private dispatch(block: string): void {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data) this.onmessage?.({ data });
  }

  private async pump(): Promise<void> {
    try {
      const res = await fetch(this.url, { signal: this.abort.signal, headers: { Accept: "text/event-stream" } });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const end = /\r?\n\r?\n/.exec(buffer);
          if (!end) break;
          this.dispatch(buffer.slice(0, end.index));
          buffer = buffer.slice(end.index + end[0].length);
        }
      }
      this.dispatch(buffer);
    } catch {
      // aborted by close(), or the stream failed: say so below unless closed
    }
    if (!this.abort.signal.aborted) this.onerror?.();
  }
}

/** Gives the process an EventSource when it has none. */
export function installEventSource(): void {
  const g = globalThis as unknown as { EventSource?: unknown };
  if (!g.EventSource) g.EventSource = FetchEventSource;
}
