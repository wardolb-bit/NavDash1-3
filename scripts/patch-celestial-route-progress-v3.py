from pathlib import Path
import re

p = Path('app/page.tsx')
text = p.read_text()

new_fn = r'''function predictedTrackCelestialEvents(route: Waypoint[], activeLeg: ReturnType<typeof selectedRouteLeg>, ownShip: AisOwnShip | null): TrackCelestialEvent[] {
  if (!ownShip || route.length < 2) return [];

  const cumulative = trackCumulativeDistances(route);
  const total = cumulative[cumulative.length - 1];
  if (!Number.isFinite(total) || total <= 0) return [];

  // Do not depend on the selected/auto leg for celestial placement. Find the
  // geometrically nearest route leg directly so Date Line / leg-selection state
  // cannot suppress the event markers.
  let nearestIndex = 1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestAlong = 0;
  for (let i = 1; i < route.length; i += 1) {
    const result = routeXteToSegmentNm(
      ownShip.lat,
      ownShip.lon,
      route[i - 1].lat,
      route[i - 1].lon,
      route[i].lat,
      route[i].lon,
    );
    if (result.distance < nearestDistance) {
      nearestDistance = result.distance;
      nearestIndex = i;
      nearestAlong = result.alongTrack;
    }
  }

  const currentAlong = Math.max(0, Math.min(total, cumulative[nearestIndex - 1] + nearestAlong));
  const remaining = Math.max(0, total - currentAlong);
  if (remaining < 0.1) return [];

  const predictionSog = Number.isFinite(ownShip.sog) && ownShip.sog > 0.1 ? ownShip.sog : 10;
  const now = new Date();
  const routeMinutes = (remaining / predictionSog) * 60;
  const maxMinutes = Math.min(7 * 24 * 60, routeMinutes);
  const stepMinutes = 5;
  const found = new Map<TrackCelestialKind, TrackCelestialEvent>();

  const sample = (minutesAhead: number) => {
    const traveledNm = predictionSog * (minutesAhead / 60);
    const pos = trackPositionAtDistance(route, cumulative, currentAlong + traveledNm);
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

  return (["sunrise", "sunset", "moonrise", "moonset"] as TrackCelestialKind[])
    .map((kind) => found.get(kind))
    .filter((event): event is TrackCelestialEvent => Boolean(event));
}
'''

text, n = re.subn(
    r'function predictedTrackCelestialEvents\(.*?\n}\n\nfunction formatTrackCelestialLocalTime',
    new_fn + '\nfunction formatTrackCelestialLocalTime',
    text,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit(f'predictor replacement count={n}')

text = text.replace('          pane: "markerPane",\n', '')

old = '''      const events = predictedTrackCelestialEvents(route, activeLeg, ownShip);\n      if (!events.length) return;'''
new = '''      const events = predictedTrackCelestialEvents(route, activeLeg, ownShip);\n      if (!events.length) {\n        if (ownShip && route.length >= 2) {\n          const diagnostic = L.circleMarker([ownShip.lat, ownShip.lon], {\n            radius: 5,\n            color: "#fb7185",\n            weight: 2,\n            fillColor: "#fb7185",\n            fillOpacity: 1,\n          })\n            .bindTooltip("CELESTIAL EVENTS: 0", { permanent: true, direction: "right", offset: [8, 0] })\n            .addTo(map);\n          celestialTrackMarkersRef.current = [diagnostic];\n        }\n        return;\n      }'''
if old not in text:
    raise SystemExit('event guard not found')
text = text.replace(old, new, 1)

p.write_text(text)
print('patched celestial route progress v3')
# trigger
