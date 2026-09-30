// Phone / tablet detection that picks the ring-pool size and the size gate.

import { describe, expect, it } from "vitest";

import { isMobileDevice } from "../device";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0 Safari/537.36";

describe("isMobileDevice", () => {
  it("flags iPhone and Android by user agent", () => {
    expect(isMobileDevice({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe(true);
    expect(isMobileDevice({ userAgent: ANDROID, maxTouchPoints: 5 })).toBe(true);
  });

  it("flags iPadOS, which sends a desktop-Mac user agent, by its touch points", () => {
    expect(isMobileDevice({ userAgent: MAC_SAFARI, maxTouchPoints: 5 })).toBe(true);
  });

  it("leaves desktops alone, touch screen or not", () => {
    expect(isMobileDevice({ userAgent: MAC_SAFARI, maxTouchPoints: 0 })).toBe(false);
    expect(isMobileDevice({ userAgent: WINDOWS, maxTouchPoints: 10 })).toBe(false);
    expect(isMobileDevice({})).toBe(false);
  });
});
