import { NextRequest, NextResponse } from "next/server";

const MSIL_BASE = "https://api.msil.go.jp";
const TRIAL_KEY = "0e83ad5d93214e04abf37c970c32b641";

const LAYERS: Record<string, string> = {
  lighthouses: "lights/lighthouse/v2",
  buoys: "lights/buoy/v2",
  beacons: "lights/beacon/v2",
  wrecks: "wrecks/v2",
  obstructions: "seabed-obstruction/v2",
  anchorages: "designated-anchor-berths/v2",
  warnings: "navigational-warnings/v2",
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const layer = searchParams.get("layer") || "";
  const bbox = searchParams.get("bbox") || "";
  const service = LAYERS[layer];

  if (!service) return NextResponse.json({ error: "Unsupported JCG layer" }, { status: 400 });
  if (!/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(bbox)) {
    return NextResponse.json({ error: "Invalid bbox" }, { status: 400 });
  }

  const key = process.env.MSIL_API_KEY || TRIAL_KEY;
  const params = new URLSearchParams({
    f: "geojson",
    where: "1=1",
    returnGeometry: "true",
    geometry: bbox,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
  });

  try {
    const response = await fetch(`${MSIL_BASE}/${service}/MapServer/1/query?${params.toString()}`, {
      headers: { "Ocp-Apim-Subscription-Key": key },
      next: { revalidate: 900 },
    });

    if (!response.ok) {
      return NextResponse.json({ error: "JCG MSIL request failed", status: response.status }, { status: 502 });
    }

    const data = await response.json();

    // MSIL v2 GeoJSON is returned in Web Mercator (EPSG:3857).
    // Leaflet GeoJSON expects longitude/latitude, so normalize point coordinates here.
    if (data?.type === "FeatureCollection" && Array.isArray(data.features)) {
      for (const feature of data.features) {
        const coords = feature?.geometry?.coordinates;
        if (feature?.geometry?.type === "Point" && Array.isArray(coords) && Math.abs(coords[0]) > 180) {
          const x = Number(coords[0]);
          const y = Number(coords[1]);
          const lon = (x / 20037508.34) * 180;
          const lat = (Math.atan(Math.exp((y / 20037508.34) * Math.PI)) * 360 / Math.PI) - 90;
          feature.geometry.coordinates = [lon, lat];
        }
      }
      if (data.crs) data.crs = { type: "name", properties: { name: "EPSG:4326" } };
    }

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
        "X-NavDash-Source": "Japan Coast Guard MSIL API",
      },
    });
  } catch {
    return NextResponse.json({ error: "JCG MSIL unavailable" }, { status: 502 });
  }
}
