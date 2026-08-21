const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const WS_PORT = Number(process.env.AIS_WS_PORT || 8081);
const BAUD_RATE = Number(process.env.AIS_BAUD || 38400);
const REQUESTED_PORT = process.env.AIS_PORT || 'COM4';
const ROUTE_STATE_PATH = process.env.NAV_ROUTE_STATE_PATH || path.join(__dirname, '..', 'data', 'loaded-route.json');
const DATA_DIR = process.env.NAVDASH_DATA_DIR || path.join(__dirname, '..', 'data');
const POSITION_HISTORY_PATH = process.env.NAV_POSITION_HISTORY_PATH || path.join(DATA_DIR, 'position-history.json');
const POSITION_HISTORY_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const POSITION_HISTORY_MIN_INTERVAL_MS = 60 * 1000;
const POSITION_HISTORY_MIN_DISTANCE_NM = 0.01;

const wss = new WebSocket.Server({ port: WS_PORT, host: '0.0.0.0' });
let serialPort = null;
let lastLineAt = null;
let lastError = null;
let lastRouteState = loadRouteState();
let routeFileExists = fs.existsSync(ROUTE_STATE_PATH);
let positionHistory = loadPositionHistory();

function normalizeRouteState(payload) {
  const rawWaypoints = Array.isArray(payload?.waypoints) ? payload.waypoints : [];
  const waypoints = rawWaypoints
    .map((wp, index) => {
      const lat = Number(wp?.lat ?? wp?.latitude);
      const lon = Number(wp?.lon ?? wp?.lng ?? wp?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

      return {
        id: typeof wp?.id === 'string' && wp.id.trim() ? wp.id : `WP${String(index + 1).padStart(2, '0')}`,
        name: typeof wp?.name === 'string' && wp.name.trim() ? wp.name : `Waypoint ${index + 1}`,
        lat,
        lon
      };
    })
    .filter(Boolean);

  const activeWaypointIndexRaw = Number(payload?.activeWaypointIndex);
  const activeWaypointIndex = Number.isFinite(activeWaypointIndexRaw) && waypoints.length >= 2
    ? Math.max(1, Math.min(Math.round(activeWaypointIndexRaw), waypoints.length - 1))
    : 1;

  return {
    type: 'route-state',
    routeName: typeof payload?.routeName === 'string' && payload.routeName.trim() ? payload.routeName.trim() : 'Loaded RTZ Route',
    waypoints,
    activeWaypointIndex,
    savedAt: typeof payload?.savedAt === 'string' ? payload.savedAt : new Date().toISOString()
  };
}

function loadRouteState() {
  try {
    if (!fs.existsSync(ROUTE_STATE_PATH)) return null;

    const routeState = normalizeRouteState(JSON.parse(fs.readFileSync(ROUTE_STATE_PATH, 'utf8')));
    if (routeState.waypoints.length < 2) return null;

    console.log(`[AIS] Loaded shared route "${routeState.routeName}" from ${ROUTE_STATE_PATH}`);
    return routeState;
  } catch (error) {
    console.log(`[AIS] Could not load shared route: ${error.message}`);
    return null;
  }
}

function saveRouteState(routeState) {
  try {
    fs.mkdirSync(path.dirname(ROUTE_STATE_PATH), { recursive: true });
    fs.writeFileSync(ROUTE_STATE_PATH, JSON.stringify(routeState, null, 2), 'utf8');
    routeFileExists = true;
    console.log(`[AIS] Saved shared route "${routeState.routeName}" to ${ROUTE_STATE_PATH}`);
  } catch (error) {
    console.log(`[AIS] Could not save shared route: ${error.message}`);
  }
}

function clearRouteState() {
  try {
    if (fs.existsSync(ROUTE_STATE_PATH)) fs.unlinkSync(ROUTE_STATE_PATH);
    routeFileExists = false;
    console.log(`[AIS] Cleared shared route at ${ROUTE_STATE_PATH}`);
  } catch (error) {
    console.log(`[AIS] Could not clear shared route: ${error.message}`);
  }
}

function sixBitCharToValue(char) {
  const code = char.charCodeAt(0);
  return code < 88 ? code - 48 : code - 56;
}

function payloadToBits(payload) {
  return payload
    .split('')
    .map(char => sixBitCharToValue(char).toString(2).padStart(6, '0'))
    .join('');
}

function getUnsigned(bits, start, length) {
  return parseInt(bits.slice(start, start + length), 2);
}

function getSigned(bits, start, length) {
  const value = getUnsigned(bits, start, length);
  const signBit = 1 << (length - 1);
  return value & signBit ? value - (1 << length) : value;
}

function decodeOwnShipPosition(sentence) {
  try {
    const clean = String(sentence || '').trim();
    if (!clean.startsWith('!AIVDO') && !clean.startsWith('$AIVDO')) return null;

    const parts = clean.split(',');
    if (parts.length < 7) return null;

    const total = Number(parts[1]);
    const fragment = Number(parts[2]);
    const payload = parts[5];
    const fillBits = Number((parts[6] || '0').split('*')[0] || 0);
    if (total !== 1 || fragment !== 1 || !payload) return null;

    const rawBits = payloadToBits(payload);
    const bits = fillBits > 0 ? rawBits.slice(0, -fillBits) : rawBits;
    const messageType = getUnsigned(bits, 0, 6);
    if (![1, 2, 3].includes(messageType)) return null;

    const sogRaw = getUnsigned(bits, 50, 10);
    const lonRaw = getSigned(bits, 61, 28);
    const latRaw = getSigned(bits, 89, 27);
    const cogRaw = getUnsigned(bits, 116, 12);
    const headingRaw = getUnsigned(bits, 128, 9);

    const lat = latRaw / 600000;
    const lon = lonRaw / 600000;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

    return {
      lat,
      lon,
      sog: sogRaw === 1023 ? null : sogRaw / 10,
      cog: cogRaw === 3600 ? null : cogRaw / 10,
      heading: headingRaw === 511 ? null : headingRaw,
      timestamp: Date.now(),
      receivedAt: new Date().toISOString()
    };
  } catch {
    return null;
  }
}

function distanceNm(aLat, aLon, bLat, bLon) {
  const radiusNm = 3440.065;
  const toRad = value => (value * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return radiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizePositionEntry(entry) {
  const lat = Number(entry?.lat);
  const lon = Number(entry?.lon);
  const timestamp = Number(entry?.timestamp);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(timestamp)) return null;

  return {
    lat,
    lon,
    timestamp,
    sog: Number.isFinite(Number(entry?.sog)) ? Number(entry.sog) : null,
    cog: Number.isFinite(Number(entry?.cog)) ? Number(entry.cog) : null,
    heading: Number.isFinite(Number(entry?.heading)) ? Number(entry.heading) : null,
    receivedAt: typeof entry?.receivedAt === 'string' ? entry.receivedAt : new Date(timestamp).toISOString()
  };
}

function loadPositionHistory() {
  try {
    if (!fs.existsSync(POSITION_HISTORY_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(POSITION_HISTORY_PATH, 'utf8'));
    const now = Date.now();
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : Array.isArray(parsed) ? parsed : [];
    return entries
      .map(normalizePositionEntry)
      .filter(Boolean)
      .filter(entry => now - entry.timestamp <= POSITION_HISTORY_MAX_AGE_MS);
  } catch (error) {
    console.log(`[AIS] Could not load position history: ${error.message}`);
    return [];
  }
}

function savePositionHistory() {
  try {
    fs.mkdirSync(path.dirname(POSITION_HISTORY_PATH), { recursive: true });
    fs.writeFileSync(POSITION_HISTORY_PATH, JSON.stringify({ entries: positionHistory }, null, 2), 'utf8');
  } catch (error) {
    console.log(`[AIS] Could not save position history: ${error.message}`);
  }
}

function recordOwnShipPosition(position) {
  if (!position) return;

  const now = Date.now();
  positionHistory = positionHistory.filter(entry => now - entry.timestamp <= POSITION_HISTORY_MAX_AGE_MS);
  const last = positionHistory[positionHistory.length - 1];

  if (last) {
    const timeSinceLast = position.timestamp - last.timestamp;
    const distanceSinceLast = distanceNm(last.lat, last.lon, position.lat, position.lon);
    if (timeSinceLast < POSITION_HISTORY_MIN_INTERVAL_MS && distanceSinceLast < POSITION_HISTORY_MIN_DISTANCE_NM) return;
  }

  positionHistory.push(position);
  savePositionHistory();
}

function broadcast(payload) {
  const message = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  });
}

fs.watchFile(ROUTE_STATE_PATH, { interval: 2000 }, (current, previous) => {
  const existsNow = current.nlink > 0;

  if (existsNow) {
    const diskRouteState = loadRouteState();
    if (diskRouteState && JSON.stringify(diskRouteState) !== JSON.stringify(lastRouteState)) {
      lastRouteState = diskRouteState;
      broadcast(lastRouteState);
      console.log(`[AIS] Broadcast refreshed shared route "${lastRouteState.routeName}" from disk.`);
    }
  } else if (routeFileExists && lastRouteState?.waypoints?.length) {
    lastRouteState = {
      type: 'route-state',
      routeName: '',
      waypoints: [],
      activeWaypointIndex: 0,
      savedAt: new Date().toISOString()
    };
    broadcast(lastRouteState);
    console.log('[AIS] Broadcast shared route clear from disk.');
  }

  routeFileExists = existsNow;
});

wss.on('connection', ws => {
  ws.send(JSON.stringify({
    type: 'status',
    connected: Boolean(serialPort?.isOpen),
    baudRate: BAUD_RATE,
    port: serialPort?.path || REQUESTED_PORT || 'auto',
    lastLineAt,
    lastError
  }));

  const diskRouteState = loadRouteState();
  if (diskRouteState) lastRouteState = diskRouteState;

  if (lastRouteState) {
    ws.send(JSON.stringify(lastRouteState));
  }

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'route-state') {
        lastRouteState = normalizeRouteState(msg);
        if (lastRouteState.waypoints.length >= 2) saveRouteState(lastRouteState);
        broadcast(lastRouteState);
      } else if (msg.type === 'route-clear') {
        lastRouteState = {
          type: 'route-state',
          routeName: '',
          waypoints: [],
          activeWaypointIndex: 0,
          savedAt: new Date().toISOString()
        };
        clearRouteState();
        broadcast(lastRouteState);
      }
    } catch (error) {
      // Ignore malformed client messages so the AIS feed keeps running.
    }
  });
});

async function choosePort() {
  if (REQUESTED_PORT) return REQUESTED_PORT;
  const ports = await SerialPort.list();
  const preferred = ports.find(p => /usb|serial|ch340|ftdi|prolific|cp210/i.test(`${p.path} ${p.manufacturer || ''} ${p.friendlyName || ''}`));
  return preferred?.path || ports[0]?.path || null;
}

async function openSerial() {
  try {
    const path = await choosePort();
    if (!path) {
      lastError = 'No serial ports found. Set AIS_PORT=COM3 or your actual port.';
      console.log(`[AIS] ${lastError}`);
      broadcast({ type: 'status', connected: false, baudRate: BAUD_RATE, port: 'none', lastError });
      setTimeout(openSerial, 5000);
      return;
    }

    serialPort = new SerialPort({
      path,
      baudRate: BAUD_RATE,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      autoOpen: false
    });

    serialPort.open(err => {
      if (err) {
        lastError = err.message;
        console.log(`[AIS] Could not open ${path}: ${err.message}`);
        broadcast({ type: 'status', connected: false, baudRate: BAUD_RATE, port: path, lastError });
        setTimeout(openSerial, 5000);
        return;
      }

      console.log(`[AIS] Reading ${path} at ${BAUD_RATE} baud. WebSocket ws://0.0.0.0:${WS_PORT}`);
      lastError = null;
      broadcast({ type: 'status', connected: true, baudRate: BAUD_RATE, port: path, lastError: null });

      const parser = serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));
      parser.on('data', line => {
        const clean = String(line || '').trim();
        if (!clean) return;
        lastLineAt = new Date().toISOString();
        recordOwnShipPosition(decodeOwnShipPosition(clean));
        broadcast({ type: 'nmea', line: clean, receivedAt: lastLineAt });
      });

      serialPort.on('error', error => {
        lastError = error.message;
        console.log(`[AIS] Serial error: ${error.message}`);
        broadcast({ type: 'status', connected: false, baudRate: BAUD_RATE, port: path, lastError });
      });

      serialPort.on('close', () => {
        console.log('[AIS] Serial port closed. Reconnecting...');
        broadcast({ type: 'status', connected: false, baudRate: BAUD_RATE, port: path, lastError: 'Serial port closed' });
        setTimeout(openSerial, 5000);
      });
    });
  } catch (error) {
    lastError = error.message;
    console.log(`[AIS] Startup error: ${error.message}`);
    broadcast({ type: 'status', connected: false, baudRate: BAUD_RATE, port: REQUESTED_PORT || 'auto', lastError });
    setTimeout(openSerial, 5000);
  }
}

console.log(`[AIS] WebSocket server started on ${WS_PORT}`);
openSerial();
