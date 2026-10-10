// Moves the console to the figure the assistant is looking at: the cleanup page
// at a reciprocal plane, the 3D-ΔPDF page at a real-space section, the Bragg
// profile at a peak, the Q–R band transform (the back-FFT check), or the
// Execution page.  Used as each measuring step finishes (when Follow is on),
// by show_in_viewer, and by the transcript's "Show" button that reopens it.

import { useDpdfStore } from "../../state/dpdfStore";
import { useNavStore } from "../../state/navStore";
import { useViewerStore, type FixedAxis } from "../../state/viewerStore";

/** A figure the assistant looked at (and the user can reopen). */
export interface ViewTarget {
  view: "cleanup" | "dpdf" | "bragg" | "consistency" | "execution";
  label: string;
  plane?: string;
  value?: number;
  axis?: FixedAxis; // cleanup: the cut axis
  index?: [number, number, number]; // dpdf: the x/y/z cut indices
  hkl?: [number, number, number]; // bragg: the peak to select
}

export function openView(target: ViewTarget): void {
  const nav = useNavStore.getState();
  switch (target.view) {
    case "cleanup":
      if (target.axis && target.value != null) {
        const vs = useViewerStore.getState();
        // The cleanup page snaps the focus to its grid once its metadata is in.
        vs.setFocus({ axis: target.axis, value: target.value });
        vs.setFixedAxis(target.axis);
      }
      nav.setTab("reciprocal");
      break;
    case "dpdf":
      if (target.index) {
        const [x, y, z] = target.index;
        useDpdfStore.getState().center(x, y, z);
      }
      nav.setTab("dpdf");
      break;
    case "bragg":
      // The Bragg page selects the fitted peak nearest this HKL.
      if (target.hkl) useViewerStore.getState().setPeakFocus(target.hkl);
      nav.setTab("bragg");
      break;
    case "consistency":
      nav.setTab("consistency");
      break;
    case "execution":
      nav.setTab("execution");
      break;
  }
}
