// Moves the console to a cut the assistant pointed at: the cleanup page at a
// reciprocal plane, or the 3D-ΔPDF page at a real-space section.  Shared by the
// show_in_viewer tool and the transcript's "Show" button that reopens it.

import { useDpdfStore } from "../../state/dpdfStore";
import { useNavStore } from "../../state/navStore";
import { useViewerStore, type FixedAxis } from "../../state/viewerStore";

/** A place in a viewer the assistant opened (and the user can reopen). */
export interface ViewTarget {
  view: "cleanup" | "dpdf";
  plane: string;
  value: number;
  label: string;
  axis?: FixedAxis; // cleanup: the cut axis
  index?: [number, number, number]; // dpdf: the x/y/z cut indices
}

export function openView(target: ViewTarget): void {
  if (target.view === "cleanup" && target.axis) {
    const vs = useViewerStore.getState();
    // The cleanup page snaps the focus to its grid once its metadata is in.
    vs.setFocus({ axis: target.axis, value: target.value });
    vs.setFixedAxis(target.axis);
    useNavStore.getState().setTab("reciprocal");
  } else if (target.view === "dpdf" && target.index) {
    const [x, y, z] = target.index;
    useDpdfStore.getState().center(x, y, z);
    useNavStore.getState().setTab("dpdf");
  }
}
