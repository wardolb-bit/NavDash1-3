from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()

replacements = [
    (
        '  const projectionEnabled = projectionMode !== "off";\n  const useAisOrigin = projectionMode !== "departure";\n',
        '  const projectionEnabled = projectionMode !== "off";\n  const departureDate = departureTime ? new Date(departureTime) : null;\n  const departureIsPast = Boolean(\n    departureDate && !Number.isNaN(departureDate.getTime()) && departureDate.getTime() <= Date.now(),\n  );\n  const useAisOrigin = projectionMode !== "departure" || (departureIsPast && Boolean(ownShip));\n',
        'projection/useAisOrigin block',
    ),
    (
        '    const departureStart = departureTime ? new Date(departureTime) : null;\n    const originPosition = projectionMode === "departure" ? departurePosition : ownShip;\n    const positionSource = projectionMode === "departure" ? "departure position/time" : "current AIS position";\n    const elapsedHours = projectionMode === "departure"\n      ? hoursBetweenDateAndUtcValid(departureStart, selectedTime.valid)\n      : Math.max(\n          hoursBetweenDateAndUtcValid(new Date(), selectedTime.valid),\n          forecastLeadHoursForSelection(timeline, selectedIndex, "", selectedTime.valid),\n        );\n',
        '    const departureStart = departureTime ? new Date(departureTime) : null;\n    const originPosition = useAisOrigin ? ownShip : departurePosition;\n    const positionSource = useAisOrigin\n      ? projectionMode === "departure"\n        ? "current AIS position (past departure)"\n        : "current AIS position"\n      : "departure position/time";\n    const elapsedHours = useAisOrigin\n      ? Math.max(\n          hoursBetweenDateAndUtcValid(new Date(), selectedTime.valid),\n          forecastLeadHoursForSelection(timeline, selectedIndex, "", selectedTime.valid),\n        )\n      : hoursBetweenDateAndUtcValid(departureStart, selectedTime.valid);\n',
        'projection origin block',
    ),
    (
        '    const originProgress = projectionMode === "departure"\n      ? projectionOriginProgress(route, departurePosition)\n      : planningOriginProgress(route, ownShip, true);\n',
        '    const originProgress = useAisOrigin\n      ? planningOriginProgress(route, ownShip, true)\n      : projectionOriginProgress(route, departurePosition);\n',
        'projection progress block',
    ),
    (
        '  }, [departurePosition, departureTime, departureCourseDeg, ownShip, planningSpeedKt, projectionEnabled, projectionMode, route, routeDistanceNm, selectedIndex, selectedTime, timeline]);\n',
        '  }, [departurePosition, departureTime, departureCourseDeg, ownShip, planningSpeedKt, projectionEnabled, projectionMode, route, routeDistanceNm, selectedIndex, selectedTime, timeline, useAisOrigin]);\n',
        'projection dependencies',
    ),
    (
        '    const originProgress = projectionMode === "departure"\n    ? projectionOriginProgress(route, departurePosition)\n    : routeProgressNearestPosition(route, ownShip);\n  const etaBaseDate = projectionMode === "departure"\n    ? (departureTime ? new Date(departureTime) : null)\n    : ownShip?.receivedAt\n      ? new Date(ownShip.receivedAt)\n      : new Date();\n',
        '    const originProgress = useAisOrigin\n      ? routeProgressNearestPosition(route, ownShip)\n      : projectionOriginProgress(route, departurePosition);\n  const etaBaseDate = useAisOrigin\n    ? ownShip?.receivedAt\n      ? new Date(ownShip.receivedAt)\n      : new Date()\n    : (departureTime ? new Date(departureTime) : null);\n',
        'route exposure origin block',
    ),
    (
        '  }, [departurePosition, departureTime, gribSummary?.routeForecast, ownShip, planningSpeedKt, projectionMode, route, selectedIndex, selectedTime?.valid]);\n',
        '  }, [departurePosition, departureTime, gribSummary?.routeForecast, ownShip, planningSpeedKt, projectionMode, route, selectedIndex, selectedTime?.valid, useAisOrigin]);\n',
        'route exposure dependencies',
    ),
]

for old, new, label in replacements:
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'Unexpected {label} count: {count}')
    s = s.replace(old, new, 1)

p.write_text(s)
