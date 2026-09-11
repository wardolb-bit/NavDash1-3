"use client";

import { useEffect } from "react";

export function AisMapReadyRetry() {
  useEffect(() => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      window.dispatchEvent(new Event("navdash-leaflet-map-ready"));
      if (attempts >= 12) window.clearInterval(timer);
    }, 500);

    return () => window.clearInterval(timer);
  }, []);

  return null;
}
