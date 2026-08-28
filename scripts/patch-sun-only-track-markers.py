from pathlib import Path
import re

p = Path('components/NavMapMainOverlayV2.tsx')
text = p.read_text()

text = text.replace('type CelestialKind = "sunrise" | "sunset" | "moonrise" | "moonset";', 'type CelestialKind = "sunrise" | "sunset";')

text, n = re.subn(r'\nfunction cMoonRaDec\(date: Date\) \{.*?\n\}\n\nfunction cAltitude', '\nfunction cAltitude', text, count=1, flags=re.S)
if n != 1:
    raise SystemExit(f'cMoonRaDec removal count={n}')

old_position = '''function cPositionAt(points: Array<[number, number]>, cumulative: number[], distanceNm: number) {
  const total = cumulative[cumulative.length - 1] || 0;
  const target = Math.max(0, Math.min(total, distanceNm));
  let i = 0;
  while (i < points.length - 2 && cumulative[i + 1] < target) i += 1;
  const start = { lat: points[i][0], lon: points[i][1] }, end = { lat: points[i + 1][0], lon: points[i + 1][1] };
  const leg = distanceAndBearing(start, end);
  if (leg.distanceNm <= 0) return start;
  const pos = destinationPoint(start.lat, start.lon, leg.bearing, target - cumulative[i]);
  return { lat: pos.lat, lon: longitudeNearReference(pos.lon, start.lon) };
}'''
new_position = '''function cPositionAt(points: Array<[number, number]>, cumulative: number[], distanceNm: number) {
  const total = cumulative[cumulative.length - 1] || 0;
  const target = Math.max(0, Math.min(total, distanceNm));
  let i = 0;
  while (i < points.length - 2 && cumulative[i + 1] < target) i += 1;
  const start = { lat: points[i][0], lon: points[i][1] }, end = { lat: points[i + 1][0], lon: points[i + 1][1] };
  const legNm = cumulative[i + 1] - cumulative[i];
  if (legNm <= 0) return start;
  const f = Math.max(0, Math.min(1, (target - cumulative[i]) / legNm));

  // Interpolate in Web Mercator, matching the exact geometry Leaflet uses to
  // draw the visible gold route segment. This keeps the event dot on the line.
  const mercatorY = (lat: number) => {
    const clipped = Math.max(-85.05112878, Math.min(85.05112878, lat));
    return Math.log(Math.tan(Math.PI / 4 + cRad(clipped) / 2));
  };
  const inverseMercatorY = (y: number) => cDeg(2 * Math.atan(Math.exp(y)) - Math.PI / 2);
  const y = mercatorY(start.lat) + (mercatorY(end.lat) - mercatorY(start.lat)) * f;
  return {
    lat: inverseMercatorY(y),
    lon: start.lon + (end.lon - start.lon) * f,
  };
}'''
if text.count(old_position) != 1:
    raise SystemExit(f'cPositionAt anchor count={text.count(old_position)}')
text = text.replace(old_position, new_position, 1)

old_sample = '''    return { pos, date, sun: cAltitude(pos.lat, pos.lon, date, cSunRaDec(date)) + 0.833, moon: cAltitude(pos.lat, pos.lon, date, cMoonRaDec(date)) + 0.3 };'''
new_sample = '''    return { pos, date, sun: cAltitude(pos.lat, pos.lon, date, cSunRaDec(date)) + 0.833 };'''
if text.count(old_sample) != 1:
    raise SystemExit(f'sample anchor count={text.count(old_sample)}')
text = text.replace(old_sample, new_sample, 1)

old_checks = '''    const checks: Array<[CelestialKind, number, number]> = [["sunrise", previous.sun, current.sun], ["sunset", previous.sun, current.sun], ["moonrise", previous.moon, current.moon], ["moonset", previous.moon, current.moon]];'''
new_checks = '''    const checks: Array<[CelestialKind, number, number]> = [["sunrise", previous.sun, current.sun], ["sunset", previous.sun, current.sun]];'''
if text.count(old_checks) != 1:
    raise SystemExit(f'checks anchor count={text.count(old_checks)}')
text = text.replace(old_checks, new_checks, 1)
text = text.replace('    if (found.size === 4) break;', '    if (found.size === 2) break;', 1)
text = text.replace('  return (["sunrise", "sunset", "moonrise", "moonset"] as CelestialKind[]).map((kind) => found.get(kind)).filter((event): event is CelestialEvent => Boolean(event));', '  return (["sunrise", "sunset"] as CelestialKind[]).map((kind) => found.get(kind)).filter((event): event is CelestialEvent => Boolean(event));', 1)

old_style = '''        const isSun = event.kind.startsWith("sun");
        const isRise = event.kind.endsWith("rise");
        const color = isSun ? (isRise ? "#fbbf24" : "#f59e0b") : (isRise ? "#a5b4fc" : "#818cf8");'''
new_style = '''        const isRise = event.kind === "sunrise";
        const color = isRise ? "#fbbf24" : "#f59e0b";'''
if text.count(old_style) != 1:
    raise SystemExit(f'style anchor count={text.count(old_style)}')
text = text.replace(old_style, new_style, 1)

p.write_text(text)
print('sun-only markers patched; marker coordinates now follow Leaflet route geometry')
