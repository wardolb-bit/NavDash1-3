"use client";

import { useEffect } from "react";

const MOBILE_MAX_WIDTH = 700;
const DESKTOP_OVERRIDE_KEY = "navdash-mobile-desktop-override";

export function MobileBridgeRedirect() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem(DESKTOP_OVERRIDE_KEY) === "true") return;
    } catch {}

    const narrow = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;
    if (narrow) window.location.replace("/mobile");
  }, []);

  return null;
}

export function requestDesktopBridgeView() {
  try { sessionStorage.setItem(DESKTOP_OVERRIDE_KEY, "true"); } catch {}
  window.location.href = "/bridge";
}
