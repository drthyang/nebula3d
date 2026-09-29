// Receiving a volume from the NeXus Viewer
// (https://drthyang.github.io/neutron-nexus-viewer/).
//
// Its "Open in NEBULA3D" button opens this app as
//   ?import=nexus-viewer&id=<uuid>&from=<viewer origin>
// and builds its symmetrized volume as a nebula3d HDF5 file
// (/entry/{data, mask, h_axis, k_axis, l_axis, ub_matrix}). The exchange:
//   app    -> viewer  { type: "nebula3d-import-ready", id }  (repeated until the file arrives)
//   viewer -> app     { type: "nebula3d-import", id, schema: "nexus-viewer/1", file: File, meta }
//                   or { type: "nebula3d-import-cancel", id, message }  (the viewer could not build it)
//   app    -> viewer  { type: "nebula3d-import-loaded", id, datasetId }
//                   or { type: "nebula3d-import-error", id, message }
// It travels over either of two links, and this app listens on both:
//  - the BroadcastChannel `nebula3d-import:<id>`, when the viewer has this app's
//    origin (both on drthyang.github.io). The viewer then opens this tab with
//    `noopener`, so the two tabs run in separate browser processes. Tabs of one
//    site that hold a window reference to each other share a renderer process
//    and its main thread, so reloading, closing or crashing the viewer would
//    also stop a pipeline run here.
//  - window.opener at the `from` origin, for a viewer on another origin (a
//    local dev server) or an older viewer that keeps a reference to this tab.
// `from` must be this app's own origin, https://drthyang.github.io, or (in
// development only) a localhost origin.

export const IMPORT_SCHEMA = "nexus-viewer/1";
const TRUSTED_ORIGINS = ["https://drthyang.github.io"];

/** The BroadcastChannel name for import `id` from a viewer on this origin. */
export function importChannelName(id: string): string {
  return `nebula3d-import:${id}`;
}

export interface ImportRequest {
  id: string;
  origin: string;
}

export interface ImportedVolume {
  file: File;
  meta: Record<string, string>;
}

/** The parts of a BroadcastChannel used here. */
export interface ImportChannel {
  postMessage(message: unknown): void;
  addEventListener(type: "message", fn: (e: MessageEvent) => void): void;
  close(): void;
}

/** The parts of the browser used here, so tests can pass a fake. */
export interface ImportHost {
  /** This page's origin. */
  origin: string;
  opener: { postMessage(message: unknown, targetOrigin: string): void } | null;
  addEventListener(type: "message", fn: (e: MessageEvent) => void): void;
  removeEventListener(type: "message", fn: (e: MessageEvent) => void): void;
  /** A BroadcastChannel called `name`, or null where the browser has none. */
  channel(name: string): ImportChannel | null;
}

function browserHost(): ImportHost {
  return {
    origin: window.location.origin,
    opener: window.opener as ImportHost["opener"],
    addEventListener: (type, fn) => window.addEventListener(type, fn),
    removeEventListener: (type, fn) => window.removeEventListener(type, fn),
    channel: (name) => (typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(name)),
  };
}

export function isTrustedOrigin(origin: string, own: string, dev: boolean): boolean {
  if (origin === own || TRUSTED_ORIGINS.includes(origin)) return true;
  if (!dev) return false;
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/** The import requested by the query string `search`, or null. */
export function parseImport(search: string, own: string, dev: boolean): ImportRequest | null {
  const params = new URLSearchParams(search);
  const id = params.get("id");
  const origin = params.get("from") ?? own;
  if (params.get("import") !== "nexus-viewer" || !id || !isTrustedOrigin(origin, own, dev)) return null;
  return { id, origin };
}

/** Drop the import parameters from the address bar, so a reload does not wait for the viewer again. */
export function clearImportParams(): void {
  const url = new URL(window.location.href);
  for (const key of ["import", "id", "from"]) url.searchParams.delete(key);
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

function toMeta(value: unknown): Record<string, string> {
  const meta: Record<string, string> = {};
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) if (typeof v === "string") meta[k] = v.slice(0, 2000);
  }
  return meta;
}

/** One way to reach the viewer. */
interface Link {
  post(message: unknown): void;
  /** Stop listening (and close the channel). */
  close(): void;
}

/**
 * The links to the viewer of `req`: its BroadcastChannel when it has this
 * page's origin, and window.opener when there is one. `onData` receives what
 * the viewer sends on any of them; without it the links only post.
 */
function openLinks(req: ImportRequest, host: ImportHost, onData?: (data: unknown) => void): Link[] {
  const links: Link[] = [];
  const channel = req.origin === host.origin ? host.channel(importChannelName(req.id)) : null;
  if (channel) {
    if (onData) channel.addEventListener("message", (e) => onData(e.data));
    links.push({ post: (m) => channel.postMessage(m), close: () => channel.close() });
  }
  const opener = host.opener;
  if (opener) {
    const onMessage = (e: MessageEvent) => {
      if (e.origin === req.origin && e.source === opener) onData?.(e.data);
    };
    if (onData) host.addEventListener("message", onMessage);
    links.push({
      post: (m) => {
        try {
          opener.postMessage(m, req.origin);
        } catch {
          // The viewer tab navigated away; the timeout reports it.
        }
      },
      close: () => host.removeEventListener("message", onMessage),
    });
  }
  return links;
}

/**
 * Ask the viewer for the volume and resolve with it. "Ready" is posted at once
 * and every `interval` ms until the file arrives, since the viewer may still be
 * building it. Rejects with no way to reach the viewer, on a malformed reply,
 * after `timeout` ms, or when `signal` aborts.
 */
export function receiveImport(
  req: ImportRequest,
  {
    host = browserHost(),
    interval = 1000,
    timeout = 600_000,
    signal,
  }: { host?: ImportHost; interval?: number; timeout?: number; signal?: AbortSignal } = {},
): Promise<ImportedVolume> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Import aborted", "AbortError"));
      return;
    }
    const finish = () => {
      clearInterval(timer);
      clearTimeout(expiry);
      for (const link of links) link.close();
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      finish();
      reject(new DOMException("Import aborted", "AbortError"));
    };
    const onData = (data: unknown) => {
      const d = data as { type?: unknown; id?: unknown; schema?: unknown; file?: unknown; meta?: unknown; message?: unknown } | null;
      if (d?.id !== req.id) return;
      if (d.type === "nebula3d-import-cancel") {
        finish();
        reject(new Error(typeof d.message === "string" ? d.message : "the NeXus Viewer cancelled the import."));
        return;
      }
      if (d.type !== "nebula3d-import") return;
      finish();
      if (d.schema !== IMPORT_SCHEMA || !(d.file instanceof Blob)) {
        reject(new Error(`unsupported message from the NeXus Viewer (expected ${IMPORT_SCHEMA}); update both apps.`));
        return;
      }
      const file = d.file instanceof File ? d.file : new File([d.file], "nexus-viewer.nxs");
      resolve({ file, meta: toMeta(d.meta) });
    };
    const links = openLinks(req, host, onData);
    if (!links.length) {
      reject(new Error("this page was not opened by the NeXus Viewer, or the viewer tab was closed."));
      return;
    }
    const ready = () => {
      for (const link of links) link.post({ type: "nebula3d-import-ready", id: req.id });
    };
    const timer = setInterval(ready, interval);
    const expiry = setTimeout(() => {
      finish();
      reject(new Error("the NeXus Viewer did not send a volume. Use Open in NEBULA3D there again."));
    }, timeout);
    signal?.addEventListener("abort", onAbort);
    ready();
  });
}

/** Tell the viewer whether the volume loaded (it shows this next to its button). */
export function reportImport(
  req: ImportRequest,
  result: { datasetId: string } | { error: string },
  host: ImportHost = browserHost(),
): void {
  const message = "error" in result
    ? { type: "nebula3d-import-error", id: req.id, message: result.error }
    : { type: "nebula3d-import-loaded", id: req.id, datasetId: result.datasetId };
  for (const link of openLinks(req, host)) {
    link.post(message);
    link.close();
  }
}
