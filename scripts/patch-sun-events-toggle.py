from pathlib import Path

p = Path('components/NavMapMainOverlayV2.tsx')
text = p.read_text()

state_anchor = '  const [measurement, setMeasurement] = useState<{ distanceNm: number; bearing: number; source: MeasureMode } | null>(null);'
state_repl = state_anchor + '\n  const [sunEventsVisible, setSunEventsVisible] = useState(true);'
if text.count(state_anchor) != 1:
    raise SystemExit(f'state anchor count={text.count(state_anchor)}')
text = text.replace(state_anchor, state_repl, 1)

celestial_anchor = '      layer.clearLayers();\n      if (!ownShip || route.length < 2) return;'
celestial_repl = '      layer.clearLayers();\n      if (!sunEventsVisible || !ownShip || route.length < 2) return;'
if text.count(celestial_anchor) != 1:
    raise SystemExit(f'celestial anchor count={text.count(celestial_anchor)}')
text = text.replace(celestial_anchor, celestial_repl, 1)

deps_anchor = '  }, [route, ownShip?.lat, ownShip?.lon, ownShip?.sog]);'
deps_repl = '  }, [route, ownShip?.lat, ownShip?.lon, ownShip?.sog, sunEventsVisible]);'
if text.count(deps_anchor) != 1:
    raise SystemExit(f'deps anchor count={text.count(deps_anchor)}')
text = text.replace(deps_anchor, deps_repl, 1)

button_anchor = '          <button type="button" style={buttonStyle(false)} onClick={clearUserChart} disabled={userMarks.length === 0}>CLEAR MARKS</button>'
toggle = '''          <button type="button" style={buttonStyle(false)} onClick={clearUserChart} disabled={userMarks.length === 0}>CLEAR MARKS</button>\n          <label style={{ ...buttonStyle(sunEventsVisible), display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer" }}>\n            <input type="checkbox" checked={sunEventsVisible} onChange={(event) => setSunEventsVisible(event.target.checked)} style={{ width: 14, height: 14, accentColor: "#fbbf24", cursor: "pointer" }} />\n            SUN EVENTS\n          </label>'''
if text.count(button_anchor) != 1:
    raise SystemExit(f'button anchor count={text.count(button_anchor)}')
text = text.replace(button_anchor, toggle, 1)

p.write_text(text)
print('added SUN EVENTS checkbox toggle')
