# Ward Maritime Nav Console - AIS + RTZ Marine Build

This build removes the NAVTOR/NavBox API layer and uses a host-computer AIS/NMEA 0183 feed instead.

## What it does

- Reads AIS/NMEA 0183 high-speed serial data at 38400 baud from the host computer.
- Broadcasts that feed over WebSocket so other devices on the same network can view the console.
- Plots ownship from `!AIVDO` AIS messages.
- Plots AIS targets from `!AIVDM` messages.
- Decodes AIS type 5 vessel names when received and shows names instead of MMSI where possible.
- Uploads `.rtz` route files and overlays the route on the Leaflet/OpenStreetMap chart.
- Adds OpenSeaMap seamark overlay for marine chart context.
- Formats courses/headings as three digits with degree symbol, such as `018°`.
- Keeps raw AIS diagnostics tucked behind a collapsible panel.

## First run

```bash
npm install
npm run dev
```

Open:

```txt
http://localhost:3000
```

## Serial port setup

The data server tries to auto-select a USB serial port. If it selects the wrong port, stop the app and start it with an explicit COM port.

Windows PowerShell:

```powershell
$env:AIS_PORT="COM3"; npm run dev
```

Windows Command Prompt:

```cmd
set AIS_PORT=COM3 && npm run dev
```

Change `COM3` to the actual port from Device Manager.

AIS/NMEA high-speed default is:

```txt
38400 baud, 8 data bits, no parity, 1 stop bit
```

## Multi-display / ECR use

The host computer must be plugged into the AIS serial feed and run the app.

Other displays on the same network can open:

```txt
http://HOST-COMPUTER-IP:3000
```

The browser clients receive AIS data from the host WebSocket server, so the ECR does not need direct serial access.

## Notes

This is a non-certified situational-awareness and recreational/offshore utility. It is not an ECDIS replacement and should not be used as the sole means of navigation.
