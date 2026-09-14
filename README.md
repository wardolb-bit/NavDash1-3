# M/V MB480 NavDash 1.3

NavDash is the Vercel-hosted navigation and operations dashboard for M/V MB480.

## Current architecture

- The NavDash web application is hosted online through Vercel.
- Shipboard AIS/position data is supplied by the separate NavDash bridge running on the vessel network.
- Browser clients connect to that bridge over WebSocket for live AIS/NMEA data.
- Shared route, weather, and application state are handled by the web application and its active backend services.
- The repository no longer contains the retired full-app USB runtime, Electron wrapper, portable-Node launcher, or local all-in-one AIS/Next.js server setup.

## Active application areas

The current build includes the bridge console, crew/mobile view, weather and weather routing, tides, celestial tools, position report, navigation brief, MSI, voyage/arrival planning, storm map, and operational tools.

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## Navigation use

NavDash is a non-certified situational-awareness and operational support tool. It is not an ECDIS replacement and should not be used as the sole means of navigation.
