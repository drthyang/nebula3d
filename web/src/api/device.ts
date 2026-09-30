// Device class for the in-browser engine's memory decisions.
//
// Phones and tablets: every browser on iOS / iPadOS is WebKit, which runs all
// of a page's workers inside ONE content process, and the OS kills that
// process — Safari then silently reloads the page, losing the run — once it
// crosses a memory limit far below a desktop's.  Android kills the renderer
// the same way.  Two things follow on those devices: no ring-worker pool
// (ringPool.ts) and a smaller, tab-wide size gate for loaded volumes
// (nebula3d.webbridge.inspect_input, told at boot).
//
// Main thread only: WorkerNavigator has no maxTouchPoints, and touch points are
// the only thing that tells iPadOS (which sends a desktop-Mac user agent) from
// a Mac — so the pipeline worker gets the answer in its boot message.
export function isMobileDevice(nav: Partial<Navigator>): boolean {
  const ua = nav.userAgent ?? "";
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return true;
  // iPadOS 13+ sends a desktop-Mac user agent; only touch support gives it away.
  return /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}
