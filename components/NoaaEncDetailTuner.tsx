"use client";

import { useEffect } from "react";

const NOAA_ENC_WMS_MARKER = "MaritimeChartService/WMSServer";
const NOAA_VISIBLE_LAYERS_WITH_OVERSCALE = "1,2,3,4,5,6,7,12";

const NOAA_DETAIL_DISPLAY_PARAMS = JSON.stringify({
  ECDISParameters: {
    DynamicParameters: {
      ParameterGroup: [
        {
          name: "DatasetDisplayRange",
          Parameter: [
            { name: "minZoom", value: 0.03 },
            { name: "maxZoom", value: 1.2 },
          ],
        },
      ],
    },
  },
});

/**
 * Fine-tunes NOAA ENC Online rendering on the main NavDash map.
 *
 * NOAA's Maritime Chart Service already selects the best available ENC by
 * compilation scale. A slightly lower DatasetDisplayRange minZoom allows a
 * finer-scale dataset to become eligible sooner while retaining NOAA's own
 * best-scale selection logic. Layer 12 enables the service's native overscale
 * warning without changing the normal chart feature groups already displayed.
 */
export function NoaaEncDetailTuner() {
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let attempts = 0;

    const apply = () => {
      if (cancelled) return;

      const host = document.getElementById("v12-map") as any;
      const map = host?.__navdashLeafletMap as any;

      if (!map) {
        attempts += 1;
        if (attempts < 120) timer = window.setTimeout(apply, 100);
        return;
      }

      let tuned = false;
      map.eachLayer?.((layer: any) => {
        const url = String(layer?._url || "");
        const layers = String(layer?.wmsParams?.layers || "");
        if (!url.includes(NOAA_ENC_WMS_MARKER) || !layers) return;

        if (typeof layer.setParams === "function") {
          layer.setParams(
            {
              layers: NOAA_VISIBLE_LAYERS_WITH_OVERSCALE,
              display_params: NOAA_DETAIL_DISPLAY_PARAMS,
            },
            false,
          );
          layer.redraw?.();
          tuned = true;
        }
      });

      if (!tuned) {
        attempts += 1;
        if (attempts < 120) timer = window.setTimeout(apply, 100);
      }
    };

    const handleMapReady = () => {
      attempts = 0;
      window.clearTimeout(timer);
      apply();
    };

    window.addEventListener("navdash-leaflet-map-ready", handleMapReady);
    apply();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("navdash-leaflet-map-ready", handleMapReady);
    };
  }, []);

  return null;
}
