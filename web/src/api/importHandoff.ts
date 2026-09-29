// Receiving a volume from the NeXus Viewer
// (https://drthyang.github.io/neutron-nexus-viewer/).
//
// Its "Open in NEBULA3D" button opens this app as
//   ?import=nexus-viewer&id=<uuid>&from=<viewer origin>
// keeps a reference to the new window, and builds its symmetrized volume as a
// nebula3d HDF5 file (/entry/{data, mask, h_axis, k_axis, l_axis, ub_matrix}).
// The exchange, only ever with window.opener at the `from` origin:
//   app    -> viewer  { type: "nebula3d-import-ready", id }  (repeated until the file arrives)
//   viewer -> app     { type: "nebula3d-import", id, schema: "nexus-viewer/1", file: File, meta }
//                   or { type: "nebula3d-import-cancel", id, message }  (the viewer could not build it)
//   app    -> viewer  { type: "nebula3d-import-loaded", id, datasetId }
//                   or { type: "nebula3d-import-error", id, message }
// `from` must be this app's own origin, https://drthyang.github.io, or (in
// development only) a localhost origin.

export const IMPORT_SCHEMA = "nexus-viewer/1";
const TRUSTED_ORIGINS = ["https://drthyang.github.io"];

export interface ImportRequest {
  id: string;
  origin: string;
}

export interface ImportedVolume {
  file: File;
  meta: Record<string, string>;
}

/** The parts of `window` used here, so tests can pass a fake. */
export interface ImportHost {
  opener: { postMessage(message: unknown, targetOrigin: string): void } | null;
  addEventListener(type: "message", fn: (e: MessageEvent) => void): void;
  removeEventListener(type: "message", fn: (e: MessageEvent) => void): void;
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

/**
 * Ask the opener for the volume and resolve with it. "Ready" is posted at once
 * and every `interval` ms until the file arrives, since the viewer may still be
 * building it. Rejects without an opener, on a malformed reply, after
 * `timeout` ms, or when `signal` aborts.
 */
export function receiveImport(
  req: ImportRequest,
  {
    host = window as unknown as ImportHost,
    interval = 1000,
    timeout = 600_000,
    signal,
  }: { host?: ImportHost; interval?: number; timeout?: number; signal?: AbortSignal } = {},
): Promise<ImportedVolume> {
  return new Promise((resolve, reject) => {
    const opener = host.opener;
    if (!opener) {
      reject(new Error("this page was not opened by the NeXus Viewer, or the viewer tab was closed."));
      return;
    }
    if (signal?.aborted) {
      reject(new DOMException("Import aborted", "AbortError"));
      return;
    }
    const ready = () => {
      try {
        opener.postMessage({ type: "nebula3d-import-ready", id: req.id }, req.origin);
      } catch {
        // The viewer tab navigated away; the timeout reports it.
      }
    };
    const timer = setInterval(ready, interval);
    const expiry = setTimeout(() => {
      finish();
      reject(new Error("the NeXus Viewer did not send a volume. Use Open in NEBULA3D there again."));
    }, timeout);
    const finish = () => {
      clearInterval(timer);
      clearTimeout(expiry);
      host.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      finish();
      reject(new DOMException("Import aborted", "AbortError"));
    };
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: unknown; id?: unknown; schema?: unknown; file?: unknown; meta?: unknown; message?: unknown } | null;
      if (e.origin !== req.origin || e.source !== opener || d?.id !== req.id) return;
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
    host.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort);
    ready();
  });
}

/** Tell the viewer whether the volume loaded (it shows this next to its button). */
export function reportImport(
  req: ImportRequest,
  result: { datasetId: string } | { error: string },
  host: Pick<ImportHost, "opener"> = window as unknown as ImportHost,
): void {
  const message = "error" in result
    ? { type: "nebula3d-import-error", id: req.id, message: result.error }
    : { type: "nebula3d-import-loaded", id: req.id, datasetId: result.datasetId };
  try {
    host.opener?.postMessage(message, req.origin);
  } catch {
    // The viewer tab is gone; nothing to tell.
  }
}
