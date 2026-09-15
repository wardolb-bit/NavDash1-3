from pathlib import Path

root = Path('target')
enc_path = root / 'components/EncObjectInfo.tsx'
layout_path = root / 'app/layout.tsx'

enc = enc_path.read_text()
layout = layout_path.read_text()

replacements = []

old = '''    let control: any = null;\n    let active = false;\n    let pendingController: AbortController | null = null;\n'''
new = '''    let pendingController: AbortController | null = null;\n'''
assert enc.count(old) == 1, f'Enc state block count {enc.count(old)}'
enc = enc.replace(old, new, 1)

for css_line in [
    '        .navdash-enc-control{display:block;border:1px solid rgba(105,215,235,.55);background:rgba(7,16,25,.92);color:#d9fbff;border-radius:4px;padding:7px 9px;font:800 11px/1 system-ui,sans-serif;letter-spacing:.06em;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.28)}\\n',
    '        .navdash-enc-control[data-active="true"]{border-color:#f1d56b;color:#f1d56b;background:rgba(29,25,10,.96)}\\n',
    '        html[data-navdash-theme="day"] .navdash-enc-control{background:rgba(255,255,255,.96);color:#16323f;border-color:rgba(25,99,120,.45)}\\n',
    '        html[data-navdash-theme="day"] .navdash-enc-control[data-active="true"]{background:#fff8d8;color:#765e00;border-color:#b89000}\\n',
]:
    assert enc.count(css_line) == 1, f'CSS line count {enc.count(css_line)}: {css_line[:50]}'
    enc = enc.replace(css_line, '', 1)

old = '''    const identify = async (event: any) => {\n      if (!active || !map || !L) return;\n      const lat = Number(event?.latlng?.lat);\n      const lon = Number(event?.latlng?.lng);\n      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;\n'''
new = '''    const identifyAt = async (lat: number, lon: number) => {\n      if (!map || !L) return;\n      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;\n'''
assert enc.count(old) == 1, f'identify header count {enc.count(old)}'
enc = enc.replace(old, new, 1)

old = '''      const popup = L.popup({ className: "navdash-enc-popup", maxWidth: 420, closeButton: true, pane: "navdashEncPopupPane" })\n        .setLatLng(event.latlng)\n'''
new = '''      const popup = L.popup({ className: "navdash-enc-popup", maxWidth: 420, closeButton: true, pane: "navdashEncPopupPane" })\n        .setLatLng([lat, lon])\n'''
assert enc.count(old) == 1, f'popup latlng count {enc.count(old)}'
enc = enc.replace(old, new, 1)

old = '''      control = L.control({ position: "topleft" });\n      control.onAdd = () => {\n        const button = L.DomUtil.create("button", "navdash-enc-control") as HTMLButtonElement;\n        button.type = "button";\n        button.textContent = "ENC INFO";\n        button.title = "Interrogate live NOAA ENC chart objects";\n        button.setAttribute("data-active", "false");\n        L.DomEvent.disableClickPropagation(button);\n        L.DomEvent.on(button, "click", (event: Event) => {\n          L.DomEvent.preventDefault(event);\n          active = !active;\n          button.setAttribute("data-active", String(active));\n          element.style.cursor = active ? "crosshair" : "";\n          if (!active) map.closePopup();\n        });\n        return button;\n      };\n      control.addTo(map);\n      map.on("click", identify);\n    };\n\n    void attach();\n\n    return () => {\n      cancelled = true;\n      window.clearTimeout(timer);\n      pendingController?.abort();\n      try { if (map) map.off("click", identify); } catch {}\n      try { if (control && map) map.removeControl(control); } catch {}\n      const element = document.getElementById(MAP_ELEMENT_ID);\n      if (element) element.style.cursor = "";\n    };\n'''
new = '''    };\n\n    const onIdentifyRequest = (event: Event) => {\n      const detail = (event as CustomEvent<{ lat?: number; lon?: number }>).detail;\n      const lat = Number(detail?.lat);\n      const lon = Number(detail?.lon);\n      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;\n      void identifyAt(lat, lon);\n    };\n\n    window.addEventListener("navdash-enc-info-request", onIdentifyRequest);\n    void attach();\n\n    return () => {\n      cancelled = true;\n      window.clearTimeout(timer);\n      pendingController?.abort();\n      window.removeEventListener("navdash-enc-info-request", onIdentifyRequest);\n    };\n'''
assert enc.count(old) == 1, f'control block count {enc.count(old)}'
enc = enc.replace(old, new, 1)

old = '''              const invokeToggle = (label) => {\n                const toggle = getOriginalToggle(label);\n                const checkbox = toggle?.querySelector('input[type="checkbox"]');\n                if (checkbox instanceof HTMLInputElement && !checkbox.disabled) checkbox.click();\n                closeMenu();\n              };\n\n              const buildMenuItem = (menu, text, action, options = {}) => {\n'''
new = '''              const invokeToggle = (label) => {\n                const toggle = getOriginalToggle(label);\n                const checkbox = toggle?.querySelector('input[type="checkbox"]');\n                if (checkbox instanceof HTMLInputElement && !checkbox.disabled) checkbox.click();\n                closeMenu();\n              };\n\n              const invokeEncInfo = (clientX, clientY) => {\n                const surface = getMapSurface();\n                const leafletMap = surface?.__navdashLeafletMap;\n                if (!(surface instanceof HTMLElement) || !leafletMap) return;\n                const rect = surface.getBoundingClientRect();\n                const latlng = leafletMap.containerPointToLatLng([clientX - rect.left, clientY - rect.top]);\n                window.dispatchEvent(new CustomEvent("navdash-enc-info-request", {\n                  detail: { lat: Number(latlng.lat), lon: Number(latlng.lng) },\n                }));\n                closeMenu();\n              };\n\n              const buildMenuItem = (menu, text, action, options = {}) => {\n'''
assert layout.count(old) == 1, f'invokeToggle block count {layout.count(old)}'
layout = layout.replace(old, new, 1)

old = '''                if (!(group instanceof HTMLElement) || !(pan instanceof HTMLButtonElement)) return;\n\n                buildMenuItem(menu, "PAN", () => invokeButton("PAN"), { active: pan.style.border.includes("34,211,238") });\n'''
new = '''                if (!(group instanceof HTMLElement) || !(pan instanceof HTMLButtonElement)) return;\n\n                buildMenuItem(menu, "INFO", () => invokeEncInfo(clientX, clientY));\n                addSeparator(menu);\n                buildMenuItem(menu, "PAN", () => invokeButton("PAN"), { active: pan.style.border.includes("34,211,238") });\n'''
assert layout.count(old) == 1, f'menu insertion count {layout.count(old)}'
layout = layout.replace(old, new, 1)

enc_path.write_text(enc)
layout_path.write_text(layout)
print('Applied ENC right-click INFO scalpel')
