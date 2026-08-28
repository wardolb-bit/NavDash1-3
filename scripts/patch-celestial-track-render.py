from pathlib import Path

p = Path('app/page.tsx')
text = p.read_text()

old_guard = '  if (!activeLeg || !ownShip || route.length < 2 || !Number.isFinite(ownShip.sog) || ownShip.sog < 0.5) return [];\n'
new_guard = '  if (!activeLeg || !ownShip || route.length < 2) return [];\n  const predictionSog = Number.isFinite(ownShip.sog) ? Math.max(0.1, ownShip.sog) : 0.1;\n'
if old_guard not in text:
    raise SystemExit('guard not found')
text = text.replace(old_guard, new_guard, 1)
text = text.replace('  const maxMinutes = Math.min(96 * 60, (remaining / ownShip.sog) * 60);', '  const maxMinutes = Math.min(7 * 24 * 60, (remaining / predictionSog) * 60);', 1)
text = text.replace('    const pos = trackPositionAtDistance(route, cumulative, currentAlong + ownShip.sog * (minutesAhead / 60));', '    const pos = trackPositionAtDistance(route, cumulative, currentAlong + predictionSog * (minutesAhead / 60));', 1)

old_render = '''      celestialTrackMarkersRef.current = events.map((event) => {
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
'''
new_render = '''      celestialTrackMarkersRef.current = events.map((event) => {
        const style = styleFor(event.kind);
        const label = `${style.label} ${formatTrackCelestialLocalTime(event)}`;
        return L.circleMarker([event.lat, event.lon], {
          radius: 7,
          color: "#071019",
          weight: 2,
          fillColor: style.dot,
          fillOpacity: 1,
          interactive: true,
          pane: "markerPane",
        })
          .bindTooltip(label, {
            permanent: true,
            direction: "right",
            offset: [8, 0],
            opacity: 0.96,
          })
          .addTo(map);
      });
'''
if old_render not in text:
    raise SystemExit('render block not found')
text = text.replace(old_render, new_render, 1)
p.write_text(text)
print('patched celestial track rendering')
