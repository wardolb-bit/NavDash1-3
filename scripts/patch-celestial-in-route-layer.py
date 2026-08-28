from pathlib import Path
import re

p = Path('app/page.tsx')
text = p.read_text()

# Remove the separate celestial effect. It was not reliably attaching to the same
# lifecycle that renders the visible route, so celestial markers are now drawn
# from the proven route-layer update itself.
text, n = re.subn(
    r'\n  useEffect\(\(\) => \{\n    async function updateCelestialTrackMarkers\(\) \{.*?\n  \}, \[route, ownShip\?\.lat, ownShip\?\.lon, ownShip\?\.sog, activeLeg\?\.index, activeLeg\?\.alongTrack\]\);\n',
    '\n',
    text,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit(f'separate celestial effect removal count={n}')

anchor = '      setTimeout(() => map.invalidateSize(), 100);'
if text.count(anchor) != 1:
    raise SystemExit(f'route layer anchor count={text.count(anchor)}')

injected = r'''      // Celestial rise/set markers deliberately share the exact same Leaflet
      // route-layer lifecycle that draws the gold route and waypoint markers.
      celestialTrackMarkersRef.current.forEach((marker) => {
        try { map.removeLayer(marker); } catch {}
      });
      celestialTrackMarkersRef.current = [];

      const celestialEvents = predictedTrackCelestialEvents(route, activeLeg, ownShip);
      if (ownShip && route.length >= 2 && celestialEvents.length === 0) {
        const diagnostic = L.circleMarker([ownShip.lat, ownShip.lon], {
          radius: 7,
          color: "#ffffff",
          weight: 2,
          fillColor: "#fb7185",
          fillOpacity: 1,
        })
          .bindTooltip("CELESTIAL EVENTS: 0", {
            permanent: true,
            direction: "right",
            offset: [10, 0],
            opacity: 1,
          })
          .addTo(map);
        celestialTrackMarkersRef.current = [diagnostic];
      } else if (celestialEvents.length) {
        const styleForCelestial = (kind: TrackCelestialKind) => {
          if (kind === "sunrise") return { dot: "#fbbf24", label: "SUNRISE" };
          if (kind === "sunset") return { dot: "#f59e0b", label: "SUNSET" };
          if (kind === "moonrise") return { dot: "#a5b4fc", label: "MOONRISE" };
          return { dot: "#818cf8", label: "MOONSET" };
        };

        celestialTrackMarkersRef.current = celestialEvents.map((event) => {
          const style = styleForCelestial(event.kind);
          const label = `${style.label} ${formatTrackCelestialLocalTime(event)}`;
          return L.circleMarker([event.lat, event.lon], {
            radius: 7,
            color: "#ffffff",
            weight: 2,
            fillColor: style.dot,
            fillOpacity: 1,
          })
            .bindTooltip(label, {
              permanent: true,
              direction: "right",
              offset: [10, 0],
              opacity: 1,
            })
            .addTo(map);
        });
      }

'''
text = text.replace(anchor, injected + anchor, 1)

old_deps = '  }, [route, routeAlerts, routeName]);'
new_deps = '  }, [route, routeAlerts, routeName, ownShip?.lat, ownShip?.lon, ownShip?.sog]);'
if text.count(old_deps) != 1:
    raise SystemExit(f'route effect dependency anchor count={text.count(old_deps)}')
text = text.replace(old_deps, new_deps, 1)

p.write_text(text)
print('moved celestial markers into proven route layer')
