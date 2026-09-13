from pathlib import Path

p = Path('app/NavDashConsole.tsx')
s = p.read_text()

old_return = '''  return {
    ratio,
    xte: distanceNm(ship, { lat: closestLat, lon: closestLon }),
    side: cross > 0 ? "STBD" : cross < 0 ? "PORT" : "--",
  };
}

function routeDtg'''
new_return = '''  return {
    ratio,
    projectionRatio,
    xte: distanceNm(ship, { lat: closestLat, lon: closestLon }),
    side: cross > 0 ? "STBD" : cross < 0 ? "PORT" : "--",
  };
}

function logicalRouteLeg(route: Waypoint[], ownShip: OwnShip | null, currentLegIndex: number) {
  if (!ownShip || route.length < 2) return null;
  let best: { index: number; metrics: ReturnType<typeof legMetrics>; score: number } | null = null;
  for (let i = 1; i < route.length; i += 1) {
    const metrics = legMetrics(ownShip, route[i - 1], route[i]);
    const jumpPenalty = Math.abs(i - currentLegIndex) * 0.35;
    const endPenalty = metrics.projectionRatio <= 0 || metrics.projectionRatio >= 1 ? 0.25 : 0;
    const score = metrics.xte + jumpPenalty + endPenalty;
    if (!best || score < best.score) best = { index: i, metrics, score };
  }
  return best;
}

function routeDtg'''
assert old_return in s, 'legMetrics return block not found'
s = s.replace(old_return, new_return, 1)

old_effect = '''  useEffect(() => {
    if (!ownShip || route.length < 2) return;
    setActiveIndex((current) => {
      let index = Math.max(1, Math.min(route.length - 1, current));
      while (index < route.length - 1) {
        const metrics = legMetrics(ownShip, route[index - 1], route[index]);
        if (metrics.ratio < 1.02) break;
        index += 1;
      }
      return index;
    });
  }, [ownShip?.lat, ownShip?.lon, route]);
'''
new_effect = '''  useEffect(() => {
    if (!ownShip || route.length < 2) return;
    setActiveIndex((current) => logicalRouteLeg(route, ownShip, current)?.index ?? current);
  }, [ownShip?.lat, ownShip?.lon, route]);
'''
assert old_effect in s, 'active leg effect not found'
s = s.replace(old_effect, new_effect, 1)
p.write_text(s)
