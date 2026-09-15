from pathlib import Path

# NOAA ENC cache behavior
p = Path('app/api/noaa-charts/wms/route.ts')
s = p.read_text()
repls = [
    ('const cacheKey = `noaa/mcs-export-v2/${utcDay}/${digest}.png`;', 'const cacheKey = `noaa/mcs-export-v3/${utcDay}/${digest}.png`;'),
    ('"cache-control": "public, max-age=86400, immutable",', '"cache-control": "no-store",'),
]
for old, new in repls:
    count = s.count(old)
    if old.startswith('"cache-control"'):
        if count != 2:
            raise SystemExit(f'Expected 2 cache-control matches, found {count}')
        s = s.replace(old, new)
    else:
        if count != 1:
            raise SystemExit(f'Expected 1 cache key match, found {count}')
        s = s.replace(old, new, 1)
p.write_text(s)

# Route weather map: match day presentation to main, keep night ENC behavior, remove wind-arrow marker creation
p = Path('app/route-weather-lab/page.tsx')
s = p.read_text()

old = '''    let brightnessMenu: HTMLDivElement | null = null;\n    let encLayer: any = null;\n'''
new = '''    let brightnessMenu: HTMLDivElement | null = null;\n    let encLayer: any = null;\n    let dayBaseLayer: any = null;\n    let daySeamarkLayer: any = null;\n'''
if s.count(old) != 1: raise SystemExit('Unexpected layer declaration block')
s = s.replace(old, new, 1)

if s.count('      encPane.style.zIndex = "200";') != 1: raise SystemExit('Unexpected ENC pane z-index')
s = s.replace('      encPane.style.zIndex = "200";', '      encPane.style.zIndex = "250";', 1)

old = '''      const createEncLayer = (night: boolean) => {\n        if (encLayer) {\n          try { map.removeLayer(encLayer); } catch {}\n          encLayer = null;\n        }\n\n        if (mapEl.current) {\n          mapEl.current.style.background = night ? "#071019" : "#dbe5e8";\n        }\n\n        encLayer = L.tileLayer.wms("/api/noaa-charts/wms", {\n          pane: "routeWeatherEnc",\n          layers: night ? "1,2,3,4,5,6,7" : "0,1,2,3,4,5,6,7",\n          format: "image/png",\n          transparent: true,\n          version: "1.1.1",\n          tileSize: 512,\n          maxZoom: 18,\n          updateWhenZooming: false,\n          keepBuffer: 2,\n          ...(night ? { display_params: encDisplayParams() } : {}),\n        } as any).addTo(map);\n\n        encLayer.on?.("load", () => applyBrightness());\n        applyBrightness();\n      };\n'''
new = '''      const removeLayer = (layer: any) => {\n        if (!layer) return;\n        try { map.removeLayer(layer); } catch {}\n      };\n\n      const createMapLayers = (night: boolean) => {\n        removeLayer(encLayer);\n        removeLayer(dayBaseLayer);\n        removeLayer(daySeamarkLayer);\n        encLayer = null;\n        dayBaseLayer = null;\n        daySeamarkLayer = null;\n\n        if (mapEl.current) {\n          mapEl.current.style.background = night ? "#071019" : "#dbe5e8";\n        }\n\n        if (!night) {\n          dayBaseLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {\n            maxZoom: 19,\n          }).addTo(map);\n          daySeamarkLayer = L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", {\n            maxZoom: 18,\n          }).addTo(map);\n        }\n\n        encLayer = L.tileLayer.wms("/api/noaa-charts/wms", {\n          pane: "routeWeatherEnc",\n          layers: night ? "1,2,3,4,5,6,7" : "0,1,2,3,4,5,6,7",\n          format: "image/png",\n          transparent: true,\n          version: "1.1.1",\n          opacity: night ? 1 : 0.9,\n          tileSize: 512,\n          maxZoom: 18,\n          updateWhenZooming: false,\n          keepBuffer: 2,\n          ...(night ? { display_params: encDisplayParams() } : {}),\n        } as any).addTo(map);\n\n        if (night) {\n          encLayer.on?.("load", () => applyBrightness());\n          applyBrightness();\n        } else {\n          encPane.style.filter = "";\n        }\n      };\n'''
if s.count(old) != 1: raise SystemExit('Unexpected createEncLayer block')
s = s.replace(old, new, 1)

old = '''        applyBrightness(next);\n        window.dispatchEvent(new CustomEvent("navdash-enc-brightness-change", { detail: next }));\n'''
new = '''        if (isNight()) applyBrightness(next);\n        window.dispatchEvent(new CustomEvent("navdash-enc-brightness-change", { detail: next }));\n'''
if s.count(old) != 1: raise SystemExit('Unexpected brightness adjustment block')
s = s.replace(old, new, 1)

if s.count('        createEncLayer(next !== "day");') != 1: raise SystemExit('Unexpected theme layer call')
s = s.replace('        createEncLayer(next !== "day");', '        createMapLayers(next !== "day");', 1)
if s.count('      createEncLayer(isNight());') != 1: raise SystemExit('Unexpected initial layer call')
s = s.replace('      createEncLayer(isNight());', '      createMapLayers(isNight());', 1)

old = '''        if (showWind && wind !== null && p.windDirectionDeg !== null && p.windDirectionDeg !== undefined) {\n          const flowDirection = (p.windDirectionDeg + 180) % 360;\n          const arrow = L.divIcon({\n            className: "",\n            html: `<div style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;color:#7dd3fc;font-size:18px;font-weight:900;text-shadow:0 1px 3px #000;transform:rotate(${flowDirection}deg)">➤</div>`,\n            iconSize: [24, 24],\n            iconAnchor: [12, 12],\n          });\n          L.marker([routePoint.lat, routePoint.lon], { icon: arrow, interactive: false }).addTo(layer);\n        }\n'''
if s.count(old) != 1: raise SystemExit('Unexpected wind arrow creation block')
s = s.replace(old, '', 1)

p.write_text(s)
