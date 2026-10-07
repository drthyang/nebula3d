// The pixel size of the view a slice is drawn in, provided by ViewFrame, so a
// viewport canvas and its overlays fill a non-square view (focus and single
// layouts) instead of letterboxing a square.

import { createContext, useContext } from "react";

export interface ViewSize {
  w: number;
  h: number;
}

export const ViewSizeContext = createContext<ViewSize>({ w: 1, h: 1 });

export function useViewSize(): ViewSize {
  return useContext(ViewSizeContext);
}
