from pathlib import Path

page_path = Path('app/page.tsx')
text = page_path.read_text()
helper = r'''
type SunRouteEvent = {
  kind: "sunrise" | "sunset";
  date: Date;
  lat: number;
  lon: number;
};

function sunPositionForRoute(date: Date) {
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
  return { ra: normalize360(toDeg(Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)))), dec: toDeg(Math.asin(Math.sin(eps) * Math.sin(lambda))) };
}

function routeGmst(date: Date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  return normalize360(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t - (t * t * t) / 38710000);
}

function routeSunAltitude(lat: number, lon: number, date: Date) {
  const sun = sunPositionForRoute(date);
  const hourAngle = toRad(normalize360(routeGmst(date) + lon - sun.ra));
  return toDeg(Math.asin(Math.sin(toRad(lat)) * Math.sin(toRad(sun.dec)) + Math.cos(toRad(lat)) * Math.cos(toRad(sun.dec)) * Math.cos(hourAngle)));
}

function routeCumulativeDistances(route: Waypoint[]) {
  const cumulative = [0];
  for (let i = 1; i < route.length; i += 1) cumulative.push(cumulative[i - 1] + distanceNm(route[i - 1].lat, route[i - 1].lon, route[i].lat, route[i].lon));
  return cumulative;
}

function routePositionAtDistance(route: Waypoint[], cumulative: number[], distanceAlongNm: number) {
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

function predictedRouteSunEvents(route: Waypoint[], activeLeg: ReturnType<typeof selectedRouteLeg>, ownShip: AisOwnShip | null): SunRouteEvent[] {
  if (!activeLeg || !ownShip || route.length < 2 || !Number.isFinite(ownShip.sog) || ownShip.sog < 0.5) return [];
  const cumulative = routeCumulativeDistances(route);
  const total = cumulative[cumulative.length - 1];
  const currentAlong = Math.max(0, Math.min(total, cumulative[activeLeg.index] + activeLeg.alongTrack));
  const remaining = Math.max(0, total - currentAlong);
  if (remaining < 0.1) return [];
  const now = new Date();
  const maxMinutes = Math.min(72 * 60, (remaining / ownShip.sog) * 60);
  const stepMinutes = 10;
  const threshold = -0.833;
  const events: SunRouteEvent[] = [];
  const sample = (minutesAhead: number) => {
    const pos = routePositionAtDistance(route, cumulative, currentAlong + ownShip.sog * (minutesAhead / 60));
    if (!pos) return null;
    const date = new Date(now.getTime() + minutesAhead * 60000);
    return { date, pos, delta: routeSunAltitude(pos.lat, pos.lon, date) - threshold };
  };
  let previous = sample(0);
  for (let minutes = stepMinutes; previous && minutes <= maxMinutes; minutes += stepMinutes) {
    const current = sample(minutes);
    if (!current) break;
    const sunrise = previous.delta < 0 && current.delta >= 0;
    const sunset = previous.delta >= 0 && current.delta < 0;
    if (sunrise || sunset) {
      const denominator = current.delta - previous.delta;
      const fraction = Math.abs(denominator) > 1e-9 ? Math.max(0, Math.min(1, -previous.delta / denominator)) : 0.5;
      const refined = sample(minutes - stepMinutes + stepMinutes * fraction);
      if (refined) events.push({ kind: sunrise ? "sunrise" : "sunset", date: refined.date, lat: refined.pos.lat, lon: refined.pos.lon });
    }
    if (events.some((event) => event.kind === "sunrise") && events.some((event) => event.kind === "sunset")) break;
    previous = current;
  }
  return [events.find((event) => event.kind === "sunrise"), events.find((event) => event.kind === "sunset")].filter((event): event is SunRouteEvent => Boolean(event));
}

function formatRouteSunLocalTime(event: SunRouteEvent) {
  const offset = Math.max(-12, Math.min(14, Math.round(event.lon / 15)));
  const local = new Date(event.date.getTime() + offset * 3600000);
  return local.toLocaleTimeString("en-US", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false });
}

'''
marker = 'export default function NavDashHomePage() {'
if 'function predictedRouteSunEvents(' not in text:
    if marker not in text:
        raise SystemExit('page component marker not found')
    text = text.replace(marker, helper + marker, 1)

if 'sunRouteMarkersRef' not in text:
    old = '  const routeMarkersRef = useRef<any[]>([]);\n  const ownMarkerRef = useRef<any>(null);'
    if old not in text:
        raise SystemExit('route marker ref anchor not found')
    text = text.replace(old, '  const routeMarkersRef = useRef<any[]>([]);\n  const sunRouteMarkersRef = useRef<any[]>([]);\n  const ownMarkerRef = useRef<any>(null);', 1)

cleanup_old = '        routeLayerRef.current = null;\n        routeMarkersRef.current = [];'
cleanup_new = '        routeLayerRef.current = null;\n        routeMarkersRef.current = [];\n        sunRouteMarkersRef.current = [];'
if cleanup_new not in text:
    if cleanup_old not in text:
        raise SystemExit('cleanup anchor not found')
    text = text.replace(cleanup_old, cleanup_new, 1)

anchor = '''  }, [route, routeAlerts, routeName]);\n\n  useEffect(() => {\n    async function updateOwnShipMarker() {'''
effect = r'''  }, [route, routeAlerts, routeName]);

  useEffect(() => {
    async function updateSunRouteMarkers() {
      const map = mapRef.current;
      if (!map) return;
      const L = await import("leaflet");
      sunRouteMarkersRef.current.forEach((marker) => { try { map.removeLayer(marker); } catch {} });
      sunRouteMarkersRef.current = [];
      const events = predictedRouteSunEvents(route, activeLeg, ownShip);
      if (!events.length) return;
      sunRouteMarkersRef.current = events.map((event) => {
        const sunrise = event.kind === "sunrise";
        const label = `${sunrise ? "SUNRISE" : "SUNSET"} ${formatRouteSunLocalTime(event)}`;
        return L.marker([event.lat, event.lon], {
          interactive: true,
          icon: L.divIcon({
            className: "",
            iconSize: [92, 26],
            iconAnchor: [9, 13],
            html: `<div style="display:flex;align-items:center;gap:5px;white-space:nowrap;pointer-events:auto"><span style="display:block;width:12px;height:12px;border-radius:50%;background:${sunrise ? "#fbbf24" : "#f59e0b"};border:2px solid #071019;box-shadow:0 0 0 1px rgba(255,255,255,.7),0 1px 4px rgba(0,0,0,.5)"></span><span style="padding:3px 5px;border:1px solid ${sunrise ? "#fbbf24" : "#f59e0b"};border-radius:3px;background:rgba(7,16,25,.9);color:${sunrise ? "#fde68a" : "#fdba74"};font:700 9px/1.1 system-ui,sans-serif;letter-spacing:.045em">${label}</span></div>`,
          }),
          zIndexOffset: 700,
        }).bindTooltip(`${sunrise ? "Sunrise" : "Sunset"} predicted on active route`, { permanent: false }).addTo(map);
      });
    }
    updateSunRouteMarkers();
    return () => {
      const map = mapRef.current;
      sunRouteMarkersRef.current.forEach((marker) => { try { map?.removeLayer(marker); } catch {} });
      sunRouteMarkersRef.current = [];
    };
  }, [route, ownShip?.lat, ownShip?.lon, ownShip?.sog, activeLeg?.index, activeLeg?.alongTrack]);

  useEffect(() => {
    async function updateOwnShipMarker() {'''
if 'async function updateSunRouteMarkers()' not in text:
    if anchor not in text:
        raise SystemExit('route effect anchor not found')
    text = text.replace(anchor, effect, 1)

page_path.write_text(text)

layout_path = Path('app/layout.tsx')
layout = layout_path.read_text()
layout = layout.replace("import { BridgeSunRouteMarkers } from '../components/BridgeSunRouteMarkers';\n", '').replace('        <BridgeSunRouteMarkers />\n', '')
layout = layout.replace("import { BridgeSunRouteMarkersV2 } from '../components/BridgeSunRouteMarkersV2';\n", '').replace('        <BridgeSunRouteMarkersV2 />\n', '')
layout_path.write_text(layout)
