from pathlib import Path

p = Path('components/NavMapMainOverlayV2.tsx')
text = p.read_text()

anchor = 'function routeSignature(route: Waypoint[]) {\n  return route.map((wp) => `${wp.id || ""}|${wp.name || ""}|${wp.lat.toFixed(6)}|${wp.lon.toFixed(6)}`).join(";");\n}\n'
if anchor not in text:
    raise SystemExit('routeSignature anchor not found')

helpers = r'''

type CelestialKind = "sunrise" | "sunset" | "moonrise" | "moonset";
type CelestialEvent = { kind: CelestialKind; date: Date; lat: number; lon: number };
const cRad = (d: number) => d * Math.PI / 180;
const cDeg = (r: number) => r * 180 / Math.PI;
const cNorm = (v: number) => ((v % 360) + 360) % 360;

function cGmst(date: Date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  return cNorm(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t - t * t * t / 38710000);
}

function cSunRaDec(date: Date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const l0 = cNorm(280.46646 + t * (36000.76983 + t * 0.0003032));
  const m = cNorm(357.52911 + t * (35999.05029 - 0.0001537 * t));
  const c = Math.sin(cRad(m)) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(cRad(2 * m)) * (0.019993 - 0.000101 * t) + Math.sin(cRad(3 * m)) * 0.000289;
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * t;
  const lambda = cRad(trueLong - 0.00569 - 0.00478 * Math.sin(cRad(omega)));
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = cRad(eps0 + 0.00256 * Math.cos(cRad(omega)));
  return { ra: cNorm(cDeg(Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)))), dec: cDeg(Math.asin(Math.sin(eps) * Math.sin(lambda))) };
}

function cMoonRaDec(date: Date) {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451543.5;
  const n = cNorm(125.1228 - 0.0529538083 * d), i = 5.1454, w = cNorm(318.0634 + 0.1643573223 * d), a = 60.2666, e = 0.0549, m = cNorm(115.3654 + 13.0649929509 * d);
  let E = cRad(m) + e * Math.sin(cRad(m)) * (1 + e * Math.cos(cRad(m)));
  for (let k = 0; k < 3; k += 1) E -= (E - e * Math.sin(E) - cRad(m)) / (1 - e * Math.cos(E));
  const xv = a * (Math.cos(E) - e), yv = a * Math.sqrt(1 - e * e) * Math.sin(E), v = cDeg(Math.atan2(yv, xv)), r = Math.sqrt(xv * xv + yv * yv);
  const xh = r * (Math.cos(cRad(n)) * Math.cos(cRad(v + w)) - Math.sin(cRad(n)) * Math.sin(cRad(v + w)) * Math.cos(cRad(i)));
  const yh = r * (Math.sin(cRad(n)) * Math.cos(cRad(v + w)) + Math.cos(cRad(n)) * Math.sin(cRad(v + w)) * Math.cos(cRad(i)));
  const zh = r * Math.sin(cRad(v + w)) * Math.sin(cRad(i));
  const lon = cDeg(Math.atan2(yh, xh)), lat = cDeg(Math.atan2(zh, Math.sqrt(xh * xh + yh * yh)));
  const ecl = cRad(23.4393 - 3.563e-7 * d);
  const xe = r * Math.cos(cRad(lon)) * Math.cos(cRad(lat)), ye = r * Math.sin(cRad(lon)) * Math.cos(cRad(lat)), ze = r * Math.sin(cRad(lat));
  const xeq = xe, yeq = ye * Math.cos(ecl) - ze * Math.sin(ecl), zeq = ye * Math.sin(ecl) + ze * Math.cos(ecl);
  return { ra: cNorm(cDeg(Math.atan2(yeq, xeq))), dec: cDeg(Math.atan2(zeq, Math.sqrt(xeq * xeq + yeq * yeq))) };
}

function cAltitude(lat: number, lon: number, date: Date, body: { ra: number; dec: number }) {
  const h = cRad(cNorm(cGmst(date) + lon - body.ra));
  return cDeg(Math.asin(Math.sin(cRad(lat)) * Math.sin(cRad(body.dec)) + Math.cos(cRad(lat)) * Math.cos(cRad(body.dec)) * Math.cos(h)));
}

function cRouteGeometry(route: Waypoint[], referenceLon: number) {
  const points = unwrapRouteNear(route, referenceLon);
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    cumulative.push(cumulative[i - 1] + distanceAndBearing({ lat: points[i - 1][0], lon: points[i - 1][1] }, { lat: points[i][0], lon: points[i][1] }).distanceNm);
  }
  return { points, cumulative };
}

function cCurrentAlong(points: Array<[number, number]>, cumulative: number[], ship: OwnShip) {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [lat1, lon1] = points[i - 1], [lat2, lon2] = points[i];
    const shipLon = longitudeNearReference(ship.lon, lon1);
    const refLat = cRad((lat1 + lat2 + ship.lat) / 3);
    const x1 = lon1 * 60 * Math.cos(refLat), y1 = lat1 * 60;
    const x2 = lon2 * 60 * Math.cos(refLat), y2 = lat2 * 60;
    const xs = shipLon * 60 * Math.cos(refLat), ys = ship.lat * 60;
    const vx = x2 - x1, vy = y2 - y1, wx = xs - x1, wy = ys - y1;
    const len2 = vx * vx + vy * vy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0;
    const px = x1 + t * vx, py = y1 + t * vy;
    const dist = Math.hypot(xs - px, ys - py);
    if (dist < bestDistance) {
      bestDistance = dist;
      const legNm = cumulative[i] - cumulative[i - 1];
      bestAlong = cumulative[i - 1] + legNm * t;
    }
  }
  return bestAlong;
}

function cPositionAt(points: Array<[number, number]>, cumulative: number[], distanceNm: number) {
  const total = cumulative[cumulative.length - 1] || 0;
  const target = Math.max(0, Math.min(total, distanceNm));
  let i = 0;
  while (i < points.length - 2 && cumulative[i + 1] < target) i += 1;
  const start = { lat: points[i][0], lon: points[i][1] }, end = { lat: points[i + 1][0], lon: points[i + 1][1] };
  const leg = distanceAndBearing(start, end);
  if (leg.distanceNm <= 0) return start;
  const pos = destinationPoint(start.lat, start.lon, leg.bearing, target - cumulative[i]);
  return { lat: pos.lat, lon: longitudeNearReference(pos.lon, start.lon) };
}

function cPredictEvents(route: Waypoint[], ship: OwnShip): CelestialEvent[] {
  if (route.length < 2) return [];
  const geometry = cRouteGeometry(route, ship.lon);
  const total = geometry.cumulative[geometry.cumulative.length - 1] || 0;
  const currentAlong = cCurrentAlong(geometry.points, geometry.cumulative, ship);
  const remaining = Math.max(0, total - currentAlong);
  if (remaining < 0.1) return [];
  const sog = Number.isFinite(ship.sog) && ship.sog > 0.5 ? ship.sog : 10;
  const maxMinutes = Math.min(7 * 24 * 60, remaining / sog * 60);
  const now = new Date();
  const found = new Map<CelestialKind, CelestialEvent>();
  const sample = (minutes: number) => {
    const pos = cPositionAt(geometry.points, geometry.cumulative, currentAlong + sog * minutes / 60);
    const date = new Date(now.getTime() + minutes * 60000);
    return { pos, date, sun: cAltitude(pos.lat, pos.lon, date, cSunRaDec(date)) + 0.833, moon: cAltitude(pos.lat, pos.lon, date, cMoonRaDec(date)) + 0.3 };
  };
  const step = 10;
  let previous = sample(0);
  for (let minutes = step; minutes <= maxMinutes; minutes += step) {
    const current = sample(minutes);
    const checks: Array<[CelestialKind, number, number]> = [["sunrise", previous.sun, current.sun], ["sunset", previous.sun, current.sun], ["moonrise", previous.moon, current.moon], ["moonset", previous.moon, current.moon]];
    for (const [kind, before, after] of checks) {
      if (found.has(kind)) continue;
      const rising = kind.endsWith("rise");
      if (!(rising ? before < 0 && after >= 0 : before >= 0 && after < 0)) continue;
      const denom = after - before;
      const f = Math.abs(denom) > 1e-9 ? Math.max(0, Math.min(1, -before / denom)) : 0.5;
      const refined = sample(minutes - step + step * f);
      found.set(kind, { kind, date: refined.date, lat: refined.pos.lat, lon: refined.pos.lon });
    }
    if (found.size === 4) break;
    previous = current;
  }
  return (["sunrise", "sunset", "moonrise", "moonset"] as CelestialKind[]).map((kind) => found.get(kind)).filter((event): event is CelestialEvent => Boolean(event));
}

function cLocalTime(event: CelestialEvent) {
  const wrappedLon = ((((event.lon + 180) % 360) + 360) % 360) - 180;
  const offset = Math.max(-12, Math.min(14, Math.round(wrappedLon / 15)));
  const local = new Date(event.date.getTime() + offset * 3600000);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}
'''
text = text.replace(anchor, anchor + helpers, 1)

ref_anchor = '  const routeLayerRef = useRef<any>(null);\n  const routeMarkersRef = useRef<any[]>([]);'
if ref_anchor not in text:
    raise SystemExit('route refs anchor not found')
text = text.replace(ref_anchor, ref_anchor + '\n  const celestialLayerRef = useRef<any>(null);', 1)

pane_anchor = '      const toolPane = map.createPane("navmap-main-tools-v1");\n      toolPane.style.zIndex = "730";'
if pane_anchor not in text:
    raise SystemExit('pane anchor not found')
text = text.replace(pane_anchor, pane_anchor + '\n      const celestialPane = map.createPane("navmap-main-celestial-v1");\n      celestialPane.style.zIndex = "740";', 1)

layer_anchor = '      measurementLayerRef.current = L.layerGroup([], { pane: "navmap-main-tools-v1" } as any).addTo(map);'
if layer_anchor not in text:
    raise SystemExit('layer anchor not found')
text = text.replace(layer_anchor, layer_anchor + '\n      celestialLayerRef.current = L.layerGroup([], { pane: "navmap-main-celestial-v1" } as any).addTo(map);', 1)

cleanup_anchor = '      userChartLayerRef.current = null; measurementLayerRef.current = null;'
if cleanup_anchor not in text:
    raise SystemExit('cleanup anchor not found')
text = text.replace(cleanup_anchor, cleanup_anchor + ' celestialLayerRef.current = null;', 1)

insert_before = '  useEffect(() => {\n    async function updateUserChart() {'
if insert_before not in text:
    raise SystemExit('user chart effect anchor not found')

effect = r'''  useEffect(() => {
    async function updateCelestial() {
      const map = mapRef.current;
      const layer = celestialLayerRef.current;
      if (!map || !layer) return;
      const L = await import("leaflet");
      layer.clearLayers();
      if (!ownShip || route.length < 2) return;
      const events = cPredictEvents(route, ownShip);
      const centerLon = map.getCenter().lng;
      for (const event of events) {
        const baseLon = longitudeNearReference(event.lon, centerLon);
        const isSun = event.kind.startsWith("sun");
        const isRise = event.kind.endsWith("rise");
        const color = isSun ? (isRise ? "#fbbf24" : "#f59e0b") : (isRise ? "#a5b4fc" : "#818cf8");
        const label = `${event.kind.toUpperCase()} ${cLocalTime(event)}`;
        for (const offset of [-360, 0, 360]) {
          L.circleMarker([event.lat, baseLon + offset], {
            pane: "navmap-main-celestial-v1",
            radius: 7,
            color: "#071019",
            fillColor: color,
            fillOpacity: 1,
            weight: 2,
          }).bindTooltip(label, { permanent: true, direction: "right", offset: [9, 0], opacity: 0.96, pane: "navmap-main-celestial-v1" }).addTo(layer);
        }
      }
    }
    updateCelestial();
  }, [route, ownShip?.lat, ownShip?.lon, ownShip?.sog]);

'''
text = text.replace(insert_before, effect + insert_before, 1)

p.write_text(text)
print('patched celestial markers into isolated main map')
