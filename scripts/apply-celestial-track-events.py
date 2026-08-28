from pathlib import Path

p = Path('app/page.tsx')
text = p.read_text()

helper = r'''
type TrackCelestialKind = "sunrise" | "sunset" | "moonrise" | "moonset";

type TrackCelestialEvent = {
  kind: TrackCelestialKind;
  date: Date;
  lat: number;
  lon: number;
};

function trackGmst(date: Date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  return normalize360(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t - (t * t * t) / 38710000);
}

function trackSunRaDec(date: Date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const l0 = normalize360(280.46646 + t * (36000.76983 + t * 0.0003032));
  const m = normalize360(357.52911 + t * (35999.05029 - 0.0001537 * t));
  const c = Math.sin(toRad(m)) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(toRad(2 * m)) * (0.019993 - 0.000101 * t) + Math.sin(toRad(3 * m)) * 0.000289;
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * t;
  const lambda = toRad(trueLong - 0.00569 - 0.00478 * Math.sin(toRad(omega)));
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = toRad(eps0 + 0.00256 * Math.cos(toRad(omega)));
  return {
    ra: normalize360(toDeg(Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)))),
    dec: toDeg(Math.asin(Math.sin(eps) * Math.sin(lambda))),
  };
}

function trackMoonRaDec(date: Date) {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451543.5;
  const n = normalize360(125.1228 - 0.0529538083 * d);
  const i = 5.1454;
  const w = normalize360(318.0634 + 0.1643573223 * d);
  const a = 60.2666;
  const e = 0.0549;
  const m = normalize360(115.3654 + 13.0649929509 * d);
  let eccentric = toRad(m) + e * Math.sin(toRad(m)) * (1 + e * Math.cos(toRad(m)));
  for (let k = 0; k < 3; k += 1) eccentric -= (eccentric - e * Math.sin(eccentric) - toRad(m)) / (1 - e * Math.cos(eccentric));
  const xv = a * (Math.cos(eccentric) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(eccentric);
  const v = toDeg(Math.atan2(yv, xv));
  const r = Math.sqrt(xv * xv + yv * yv);
  const xh = r * (Math.cos(toRad(n)) * Math.cos(toRad(v + w)) - Math.sin(toRad(n)) * Math.sin(toRad(v + w)) * Math.cos(toRad(i)));
  const yh = r * (Math.sin(toRad(n)) * Math.cos(toRad(v + w)) + Math.cos(toRad(n)) * Math.sin(toRad(v + w)) * Math.cos(toRad(i)));
  const zh = r * Math.sin(toRad(v + w)) * Math.sin(toRad(i));
  const lon = toDeg(Math.atan2(yh, xh));
  const lat = toDeg(Math.atan2(zh, Math.sqrt(xh * xh + yh * yh)));
  const ecl = toRad(23.4393 - 3.563e-7 * d);
  const xe = r * Math.cos(toRad(lon)) * Math.cos(toRad(lat));
  const ye = r * Math.sin(toRad(lon)) * Math.cos(toRad(lat));
  const ze = r * Math.sin(toRad(lat));
  const xeq = xe;
  const yeq = ye * Math.cos(ecl) - ze * Math.sin(ecl);
  const zeq = ye * Math.sin(ecl) + ze * Math.cos(ecl);
  return {
    ra: normalize360(toDeg(Math.atan2(yeq, xeq))),
    dec: toDeg(Math.atan2(zeq, Math.sqrt(xeq * xeq + yeq * yeq))),
  };
}

function trackBodyAltitude(lat: number, lon: number, date: Date, body: { ra: number; dec: number }) {
  const hourAngle = toRad(normalize360(trackGmst(date) + lon - body.ra));
  return toDeg(Math.asin(Math.sin(toRad(lat)) * Math.sin(toRad(body.dec)) + Math.cos(toRad(lat)) * Math.cos(toRad(body.dec)) * Math.cos(hourAngle)));
}

function trackCumulativeDistances(route: Waypoint[]) {
  const cumulative = [0];
  for (let i = 1; i < route.length; i += 1) cumulative.push(cumulative[i - 1] + distanceNm(route[i - 1].lat, route[i - 1].lon, route[i].lat, route[i].lon));
  return cumulative;
}

function trackPositionAtDistance(route: Waypoint[], cumulative: number[], distanceAlongNm: number) {
  if (route.length < 2) return null;
  const total = cumulative[cumulative.length - 1];
  const target = Math.max(0, Math.min(total, distanceAlongNm));
  let index = 0;
  while (index < route.length - 2 && cumulative[index + 1] < target) index += 1;
  const start = route[index];
  const end = route[index + 1];
  const legDistance = cumulative[index + 1] - cumulative[index];
  if (legDistance <= 0) return { lat: start.lat, lon: start.lon };
  return destinationPoint(start.lat, start.lon, bearingDeg(start.lat, start.lon, end.lat, end.lon), target - cumulative[index]);
}

function predictedTrackCelestialEvents(route: Waypoint[], activeLeg: ReturnType<typeof selectedRouteLeg>, ownShip: AisOwnShip | null): TrackCelestialEvent[] {
  if (!activeLeg || !ownShip || route.length < 2 || !Number.isFinite(ownShip.sog) || ownShip.sog < 0.5) return [];
  const cumulative = trackCumulativeDistances(route);
  const total = cumulative[cumulative.length - 1];
  const legStartIndex = Math.max(0, activeLeg.index - 1);
  const currentAlong = Math.max(0, Math.min(total, cumulative[legStartIndex] + activeLeg.alongTrack));
  const remaining = Math.max(0, total - currentAlong);
  if (remaining < 0.1) return [];

  const now = new Date();
  const maxMinutes = Math.min(96 * 60, (remaining / ownShip.sog) * 60);
  const stepMinutes = 10;
  const found = new Map<TrackCelestialKind, TrackCelestialEvent>();
  const sample = (minutesAhead: number) => {
    const pos = trackPositionAtDistance(route, cumulative, currentAlong + ownShip.sog * (minutesAhead / 60));
    if (!pos) return null;
    const date = new Date(now.getTime() + minutesAhead * 60000);
    return {
      date,
      pos,
      sun: trackBodyAltitude(pos.lat, pos.lon, date, trackSunRaDec(date)) + 0.833,
      moon: trackBodyAltitude(pos.lat, pos.lon, date, trackMoonRaDec(date)) + 0.3,
    };
  };

  let previous = sample(0);
  for (let minutes = stepMinutes; previous && minutes <= maxMinutes; minutes += stepMinutes) {
    const current = sample(minutes);
    if (!current) break;
    const crossings: Array<[TrackCelestialKind, number, number]> = [
      ["sunrise", previous.sun, current.sun],
      ["sunset", previous.sun, current.sun],
      ["moonrise", previous.moon, current.moon],
      ["moonset", previous.moon, current.moon],
    ];
    for (const [kind, before, after] of crossings) {
      if (found.has(kind)) continue;
      const rising = kind === "sunrise" || kind === "moonrise";
      const crossed = rising ? before < 0 && after >= 0 : before >= 0 && after < 0;
      if (!crossed) continue;
      const denominator = after - before;
      const fraction = Math.abs(denominator) > 1e-9 ? Math.max(0, Math.min(1, -before / denominator)) : 0.5;
      const refined = sample(minutes - stepMinutes + stepMinutes * fraction);
      if (refined) found.set(kind, { kind, date: refined.date, lat: refined.pos.lat, lon: refined.pos.lon });
    }
    if (found.size === 4) break;
    previous = current;
  }

  return (["sunrise", "sunset", "moonrise", "moonset"] as TrackCelestialKind[]).map((kind) => found.get(kind)).filter((event): event is TrackCelestialEvent => Boolean(event));
}

function formatTrackCelestialLocalTime(event: TrackCelestialEvent) {
  const zone = destinationTimeZoneForPosition({ lat: event.lat, lon: event.lon });
  if (zone.timeZone) {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone.timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(event.date);
  }
  const adjusted = new Date(event.date.getTime() + zone.offsetHours * 3600000);
  return adjusted.toLocaleTimeString("en-US", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false });
}

'''
anchor = 'export default function NavDashHomePage() {'
if 'function predictedTrackCelestialEvents(' not in text:
    if anchor not in text:
        raise SystemExit('component anchor not found')
    text = text.replace(anchor, helper + anchor, 1)

if 'celestialTrackMarkersRef' not in text:
    old = '  const routeMarkersRef = useRef<any[]>([]);\n  const ownMarkerRef = useRef<any>(null);'
    if old not in text:
        raise SystemExit('ref anchor not found')
    text = text.replace(old, '  const routeMarkersRef = useRef<any[]>([]);\n  const celestialTrackMarkersRef = useRef<any[]>([]);\n  const ownMarkerRef = useRef<any>(null);', 1)

cleanup_old = '        routeLayerRef.current = null;\n        routeMarkersRef.current = [];'
cleanup_new = '        routeLayerRef.current = null;\n        routeMarkersRef.current = [];\n        celestialTrackMarkersRef.current = [];'
if cleanup_new not in text:
    if cleanup_old not in text:
        raise SystemExit('map cleanup anchor not found')
    text = text.replace(cleanup_old, cleanup_new, 1)

route_effect_end = '  }, [route, routeAlerts, routeName]);\n\n  useEffect(() => {\n    async function updateOwnShipMarker() {'
celestial_effect = r'''  }, [route, routeAlerts, routeName]);

  useEffect(() => {
    async function updateCelestialTrackMarkers() {
      const map = mapRef.current;
      if (!map) return;
      const L = await import("leaflet");
      celestialTrackMarkersRef.current.forEach((marker) => {
        try { map.removeLayer(marker); } catch {}
      });
      celestialTrackMarkersRef.current = [];

      const events = predictedTrackCelestialEvents(route, activeLeg, ownShip);
      if (!events.length) return;

      const styleFor = (kind: TrackCelestialKind) => {
        if (kind === "sunrise") return { dot: "#fbbf24", text: "#fde68a", label: "SUNRISE", glyph: "☀" };
        if (kind === "sunset") return { dot: "#f59e0b", text: "#fdba74", label: "SUNSET", glyph: "☀" };
        if (kind === "moonrise") return { dot: "#a5b4fc", text: "#c7d2fe", label: "MOONRISE", glyph: "☾" };
        return { dot: "#818cf8", text: "#c7d2fe", label: "MOONSET", glyph: "☾" };
      };

      celestialTrackMarkersRef.current = events.map((event) => {
        const style = styleFor(event.kind);
        const label = `${style.label} ${formatTrackCelestialLocalTime(event)}`;
        return L.marker([event.lat, event.lon], {
          interactive: true,
          zIndexOffset: 800,
          icon: L.divIcon({
            className: "",
            iconSize: [112, 28],
            iconAnchor: [10, 14],
            html: `<div style="display:flex;align-items:center;gap:5px;white-space:nowrap;pointer-events:auto"><span style="display:flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:${style.dot};border:2px solid #071019;box-shadow:0 0 0 1px rgba(255,255,255,.65),0 1px 4px rgba(0,0,0,.55);color:#071019;font:900 9px/1 system-ui">${style.glyph}</span><span style="padding:3px 5px;border:1px solid ${style.dot};border-radius:3px;background:rgba(7,16,25,.92);color:${style.text};font:700 9px/1.1 system-ui,sans-serif;letter-spacing:.04em">${label}</span></div>`,
          }),
        }).bindTooltip(`${style.label} predicted on active route`, { permanent: false }).addTo(map);
      });
    }

    updateCelestialTrackMarkers();
    return () => {
      const map = mapRef.current;
      celestialTrackMarkersRef.current.forEach((marker) => {
        try { map?.removeLayer(marker); } catch {}
      });
      celestialTrackMarkersRef.current = [];
    };
  }, [route, ownShip?.lat, ownShip?.lon, ownShip?.sog, activeLeg?.index, activeLeg?.alongTrack]);

  useEffect(() => {
    async function updateOwnShipMarker() {'''
if 'async function updateCelestialTrackMarkers()' not in text:
    if route_effect_end not in text:
        raise SystemExit('route effect end anchor not found')
    text = text.replace(route_effect_end, celestial_effect, 1)

p.write_text(text)
