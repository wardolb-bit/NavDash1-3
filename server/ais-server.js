const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');

const PUBLIC_PORT = Number(process.env.AIS_WS_PORT || 8081);
const HTTP_INTERNAL_PORT = Number(process.env.AIS_HTTP_INTERNAL_PORT || 18081);
const HTTPS_INTERNAL_PORT = Number(process.env.AIS_HTTPS_INTERNAL_PORT || 18443);
const WS_PORT = PUBLIC_PORT;
const WSS_PORT = PUBLIC_PORT;
const TLS_CERT_PATH = process.env.AIS_TLS_CERT || path.join(__dirname, 'certs', 'navdash-server.crt');
const TLS_KEY_PATH = process.env.AIS_TLS_KEY || path.join(__dirname, 'certs', 'navdash-server.key');
const BAUD_RATE = Number(process.env.AIS_BAUD || 38400);
const REQUESTED_PORT = process.env.AIS_PORT || 'COM4';
const DATA_DIR = process.env.NAVDASH_DATA_DIR || path.join(__dirname, '..', 'data');
const ROUTE_STATE_PATH = process.env.NAV_ROUTE_STATE_PATH || path.join(DATA_DIR, 'loaded-route.json');
const AMI_STATE_PATH = process.env.NAV_AMI_STATE_PATH || path.join(DATA_DIR, 'ami-route-forecast.json');
const POSITION_HISTORY_PATH = process.env.NAV_POSITION_HISTORY_PATH || path.join(DATA_DIR, 'position-history.json');
const POSITION_HISTORY_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const POSITION_HISTORY_MIN_INTERVAL_MS = 60 * 1000;
const POSITION_HISTORY_MIN_DISTANCE_NM = 0.01;
const EGC_DIR = process.env.FELCOM_EGC_DIR || 'C:\\Users\\havennav\\Documents\\felcom19\\egc';
const EGC_SCAN_INTERVAL_MS = Number(process.env.EGC_SCAN_INTERVAL_MS || 5000);

let secureServer = null;
let secureWss = null;
let serialPort = null;
let lastLineAt = null;
let lastError = null;
let routeFileExists = fs.existsSync(ROUTE_STATE_PATH);
let lastRouteState = loadRouteState();
let lastAmiState = loadAmiState();
let positionHistory = loadPositionHistory();
let egcMessages = [];
let egcLastScanAt = null;
let egcLastError = null;
let egcLastSignature = '';

const httpServer = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/navdash-root-ca.crt') {
    const rootCaPath = path.join(__dirname, 'certs', 'navdash-root-ca.crt');
    try {
      const rootCa = fs.readFileSync(rootCaPath);
      res.writeHead(200, {
        'Content-Type': 'application/x-x509-ca-cert',
        'Content-Disposition': 'attachment; filename=navdash-root-ca.crt',
      });
      res.end(rootCa);
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'NavDash root CA not found' }));
    }
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      websocket: `ws://10.129.4.102:${WS_PORT}`,
      secureWebsocket: secureServer ? `wss://10.129.4.102:${WSS_PORT}` : null,
      routeLoaded: Boolean(lastRouteState?.waypoints?.length >= 2),
      amiInitialized: Boolean(lastAmiState?.initialized),
    }));
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/position-history') {
    const now = Date.now();
    positionHistory = positionHistory
      .filter((entry) => now - entry.timestamp <= POSITION_HISTORY_MAX_AGE_MS)
      .sort((a, b) => a.timestamp - b.timestamp);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      entries: positionHistory,
      sampleCount: positionHistory.length,
      oldestTimestamp: positionHistory[0]?.timestamp ?? null,
      newestTimestamp: positionHistory[positionHistory.length - 1]?.timestamp ?? null,
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const wss = new WebSocket.Server({ server: httpServer });
try {
  secureServer = https.createServer({
    cert: fs.readFileSync(TLS_CERT_PATH),
    key: fs.readFileSync(TLS_KEY_PATH),
  });
  secureWss = new WebSocket.Server({ server: secureServer });
} catch (error) {
  console.log(`[AIS] Secure WebSocket disabled: ${error.message}`);
}

function normalizeRouteState(payload) {
  const rawWaypoints = Array.isArray(payload?.waypoints) ? payload.waypoints : [];
  const waypoints = rawWaypoints
    .map((wp, index) => {
      const lat = Number(wp?.lat ?? wp?.latitude);
      const lon = Number(wp?.lon ?? wp?.lng ?? wp?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        id: `WP${String(index + 1).padStart(2, '0')}`,
        name: typeof wp?.name === 'string' && wp.name.trim() ? wp.name.trim() : `Waypoint ${index + 1}`,
        lat,
        lon,
      };
    })
    .filter(Boolean);

  const rawIndex = Number(payload?.activeWaypointIndex);
  const activeWaypointIndex = Number.isFinite(rawIndex) && waypoints.length >= 2
    ? Math.max(1, Math.min(Math.round(rawIndex), waypoints.length - 1))
    : 1;

  return {
    type: 'route-state',
    routeName: typeof payload?.routeName === 'string' && payload.routeName.trim()
      ? payload.routeName.trim()
      : 'Loaded RTZ Route',
    waypoints,
    activeWaypointIndex,
    savedAt: typeof payload?.savedAt === 'string' ? payload.savedAt : new Date().toISOString(),
  };
}

function loadRouteState() {
  try {
    if (!fs.existsSync(ROUTE_STATE_PATH)) return null;
    const state = normalizeRouteState(JSON.parse(fs.readFileSync(ROUTE_STATE_PATH, 'utf8')));
    if (state.waypoints.length < 2) return null;
    console.log(`[AIS] Loaded shared route "${state.routeName}" from ${ROUTE_STATE_PATH}`);
    return state;
  } catch (error) {
    console.log(`[AIS] Could not load shared route: ${error.message}`);
    return null;
  }
}

function saveRouteState(state) {
  try {
    fs.mkdirSync(path.dirname(ROUTE_STATE_PATH), { recursive: true });
    fs.writeFileSync(ROUTE_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
    routeFileExists = true;
    console.log(`[AIS] Saved shared route "${state.routeName}" to ${ROUTE_STATE_PATH}`);
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

function normalizeAmiState(payload) {
  const forecast = payload?.forecast && typeof payload.forecast === 'object' ? payload.forecast : null;
  return {
    type: 'ami-state',
    initialized: Boolean(payload?.initialized ?? true),
    forecast,
    savedAt: typeof payload?.savedAt === 'string' ? payload.savedAt : new Date().toISOString(),
  };
}

function loadAmiState() {
  try {
    if (!fs.existsSync(AMI_STATE_PATH)) {
      return { type: 'ami-state', initialized: false, forecast: null, savedAt: null };
    }
    return normalizeAmiState(JSON.parse(fs.readFileSync(AMI_STATE_PATH, 'utf8')));
  } catch (error) {
    console.log(`[AMI] Could not load shared AMI state: ${error.message}`);
    return { type: 'ami-state', initialized: false, forecast: null, savedAt: null };
  }
}

function saveAmiState(state) {
  try {
    fs.mkdirSync(path.dirname(AMI_STATE_PATH), { recursive: true });
    fs.writeFileSync(AMI_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
    console.log(`[AMI] Saved shared AMI state to ${AMI_STATE_PATH}`);
  } catch (error) {
    console.log(`[AMI] Could not save shared AMI state: ${error.message}`);
  }
}

function sixBitCharToValue(char) {
  const code = char.charCodeAt(0);
  return code < 88 ? code - 48 : code - 56;
}

function payloadToBits(payload) {
  return payload.split('').map((char) => sixBitCharToValue(char).toString(2).padStart(6, '0')).join('');
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
      receivedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function distanceNm(aLat, aLon, bLat, bLon) {
  const radiusNm = 3440.065;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
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
    receivedAt: typeof entry?.receivedAt === 'string' ? entry.receivedAt : new Date(timestamp).toISOString(),
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
      .filter((entry) => now - entry.timestamp <= POSITION_HISTORY_MAX_AGE_MS);
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
  positionHistory = positionHistory.filter((entry) => now - entry.timestamp <= POSITION_HISTORY_MAX_AGE_MS);
  const last = positionHistory[positionHistory.length - 1];
  if (last) {
    const timeSinceLast = position.timestamp - last.timestamp;
    const distanceSinceLast = distanceNm(last.lat, last.lon, position.lat, position.lon);
    if (timeSinceLast < POSITION_HISTORY_MIN_INTERVAL_MS && distanceSinceLast < POSITION_HISTORY_MIN_DISTANCE_NM) return;
  }
  positionHistory.push(position);
  savePositionHistory();
}

function parseEgcReceivedAt(raw) {
  const match = String(raw || '').match(/(\d{2})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, yy, mm, dd, hh, minute] = match;
  const date = new Date(Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd), Number(hh), Number(minute)));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function egcHeaderField(text, label) {
  const pattern = new RegExp(`^${label}\\s*:\\s*(.+)$`, 'mi');
  return text.match(pattern)?.[1]?.trim() || '';
}

function parseEgcFile(filePath) {
  const stat = fs.statSync(filePath);
  const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  const firstLine = lines[0]?.trim() || '';
  const type = firstLine.match(/^EGC Message\s+---\s+(.+?)\s+---\s*$/i)?.[1]?.trim() || 'EGC Message';
  const separatorIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '');
  const body = (separatorIndex >= 0 ? lines.slice(separatorIndex + 1) : lines).join('\n').trim();
  const sequence = egcHeaderField(raw, 'Message Sequence No\\.');
  const les = egcHeaderField(raw, 'LES');
  const priority = egcHeaderField(raw, 'Priority');
  const size = egcHeaderField(raw, 'Size');
  const receiveText = egcHeaderField(raw, 'Receive Date & Time');
  const receivedAt = parseEgcReceivedAt(receiveText);
  const navMatch = body.match(/\bNAVAREA\s+([IVXLC]+)\s+(\d+\/\d+)\b/i);
  const cancellationMatch = body.match(/\bCANCEL(?:S|LED)?\s+NAVAREA\s+([IVXLC]+)\s+(\d+\/\d+)\b/i);
  return {
    id: `${filePath}:${sequence || stat.mtimeMs}`,
    filename: path.basename(filePath),
    type,
    sequence,
    les,
    priority,
    size,
    receiveText,
    receivedAt,
    navarea: navMatch?.[1]?.toUpperCase() || '',
    warningNumber: navMatch?.[2] || '',
    cancelledNavarea: cancellationMatch?.[1]?.toUpperCase() || '',
    cancelledWarningNumber: cancellationMatch?.[2] || '',
    isCancellation: Boolean(cancellationMatch),
    body,
    modifiedAt: stat.mtime.toISOString(),
  };
}

function listEgcFilesRecursive(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listEgcFilesRecursive(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function getEgcSnapshot() {
  return {
    type: 'egc-snapshot',
    connected: true,
    directory: EGC_DIR,
    scannedAt: egcLastScanAt,
    lastError: egcLastError,
    messages: egcMessages,
  };
}

function scanEgcDirectory(forceBroadcast = false) {
  try {
    if (!fs.existsSync(EGC_DIR)) throw new Error(`FELCOM EGC folder not found: ${EGC_DIR}`);
    const parsed = listEgcFilesRecursive(EGC_DIR)
      .map((filePath) => {
        try { return parseEgcFile(filePath); }
        catch (error) {
          console.log(`[EGC] Skipping ${filePath}: ${error.message}`);
          return null;
        }
      })
      .filter((item) => item && (item.body || item.sequence));

    parsed.sort((a, b) => (Date.parse(b.receivedAt || b.modifiedAt || '') || 0) - (Date.parse(a.receivedAt || a.modifiedAt || '') || 0));
    egcMessages = parsed;
    egcLastScanAt = new Date().toISOString();
    egcLastError = null;

    const signature = JSON.stringify(egcMessages.map((item) => [item.id, item.modifiedAt, item.sequence]));
    if (forceBroadcast || signature !== egcLastSignature) {
      egcLastSignature = signature;
      broadcast(getEgcSnapshot());
    }
  } catch (error) {
    const nextError = error.message;
    const changed = nextError !== egcLastError;
    egcLastScanAt = new Date().toISOString();
    egcLastError = nextError;
    if (forceBroadcast || changed) broadcast(getEgcSnapshot());
  }
}

function broadcast(payload) {
  const message = JSON.stringify(payload);
  const sendTo = (server) => server?.clients?.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  });
  sendTo(wss);
  sendTo(secureWss);
}

fs.watchFile(ROUTE_STATE_PATH, { interval: 2000 }, (current) => {
  const existsNow = current.nlink > 0;
  if (existsNow) {
    const disk = loadRouteState();
    if (disk && JSON.stringify(disk) !== JSON.stringify(lastRouteState)) {
      lastRouteState = disk;
      broadcast(lastRouteState);
      console.log(`[AIS] Broadcast refreshed shared route "${lastRouteState.routeName}" from disk.`);
    }
  } else if (routeFileExists && lastRouteState?.waypoints?.length) {
    lastRouteState = {
      type: 'route-state',
      routeName: '',
      waypoints: [],
      activeWaypointIndex: 0,
      savedAt: new Date().toISOString(),
    };
    broadcast(lastRouteState);
    console.log('[AIS] Broadcast shared route clear from disk.');
  }
  routeFileExists = existsNow;
});

function handleWsConnection(ws) {
  ws.send(JSON.stringify({
    type: 'status',
    connected: Boolean(serialPort?.isOpen),
    baudRate: BAUD_RATE,
    port: serialPort?.path || REQUESTED_PORT || 'auto',
    lastLineAt,
    lastError,
  }));

  const diskRoute = loadRouteState();
  if (diskRoute) lastRouteState = diskRoute;
  if (lastRouteState) ws.send(JSON.stringify(lastRouteState));

  lastAmiState = loadAmiState();
  ws.send(JSON.stringify(lastAmiState));

  ws.send(JSON.stringify({
    type: 'position-history',
    entries: positionHistory,
    sampleCount: positionHistory.length,
    oldestTimestamp: positionHistory[0]?.timestamp ?? null,
    newestTimestamp: positionHistory[positionHistory.length - 1]?.timestamp ?? null,
  }));
  ws.send(JSON.stringify(getEgcSnapshot()));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'position-history-request') {
        ws.send(JSON.stringify({
          type: 'position-history',
          entries: positionHistory,
          sampleCount: positionHistory.length,
          oldestTimestamp: positionHistory[0]?.timestamp ?? null,
          newestTimestamp: positionHistory[positionHistory.length - 1]?.timestamp ?? null,
        }));
      } else if (msg.type === 'route-state') {
        lastRouteState = normalizeRouteState(msg);
        if (lastRouteState.waypoints.length >= 2) saveRouteState(lastRouteState);
        broadcast(lastRouteState);
      } else if (msg.type === 'route-clear') {
        lastRouteState = {
          type: 'route-state',
          routeName: '',
          waypoints: [],
          activeWaypointIndex: 0,
          savedAt: new Date().toISOString(),
        };
        clearRouteState();
        broadcast(lastRouteState);
      } else if (msg.type === 'ami-state-request') {
        ws.send(JSON.stringify(lastAmiState));
      } else if (msg.type === 'ami-state') {
        lastAmiState = normalizeAmiState(msg);
        saveAmiState(lastAmiState);
        broadcast(lastAmiState);
      } else if (msg.type === 'egc-refresh') {
        scanEgcDirectory(true);
      }
    } catch {
      // Ignore malformed client messages so the AIS feed keeps running.
    }
  });
}

wss.on('connection', handleWsConnection);
if (secureWss) secureWss.on('connection', handleWsConnection);

async function choosePort() {
  if (REQUESTED_PORT) return REQUESTED_PORT;
  const ports = await SerialPort.list();
  const preferred = ports.find((item) => /usb|serial|ch340|ftdi|prolific|cp210/i.test(`${item.path} ${item.manufacturer || ''} ${item.friendlyName || ''}`));
  return preferred?.path || ports[0]?.path || null;
}

async function openSerial() {
  try {
    const serialPath = await choosePort();
    if (!serialPath) {
      lastError = 'No serial ports found. Set AIS_PORT=COM3 or your actual port.';
      console.log(`[AIS] ${lastError}`);
      broadcast({ type: 'status', connected: false, baudRate: BAUD_RATE, port: 'none', lastError });
      setTimeout(openSerial, 5000);
      return;
    }

    serialPort = new SerialPort({
      path: serialPath,
      baudRate: BAUD_RATE,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      autoOpen: false,
    });

    serialPort.open((error) => {
      if (error) {
        lastError = error.message;
        console.log(`[AIS] Could not open ${serialPath}: ${error.message}`);
        broadcast({ type: 'status', connected: false, baudRate: BAUD_RATE, port: serialPath, lastError });
        setTimeout(openSerial, 5000);
        return;
      }

      console.log(`[AIS] Reading ${serialPath} at ${BAUD_RATE} baud. WebSocket ws://0.0.0.0:${WS_PORT}`);
      lastError = null;
      broadcast({ type: 'status', connected: true, baudRate: BAUD_RATE, port: serialPath, lastError: null });

      const parser = serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));
      parser.on('data', (line) => {
        const clean = String(line || '').trim();
        if (!clean) return;
        lastLineAt = new Date().toISOString();
        recordOwnShipPosition(decodeOwnShipPosition(clean));
        broadcast({ type: 'nmea', line: clean, receivedAt: lastLineAt });
      });

      serialPort.on('error', (serialError) => {
        lastError = serialError.message;
        console.log(`[AIS] Serial error: ${serialError.message}`);
        broadcast({ type: 'status', connected: false, baudRate: BAUD_RATE, port: serialPath, lastError });
      });

      serialPort.on('close', () => {
        console.log('[AIS] Serial port closed. Reconnecting...');
        broadcast({ type: 'status', connected: false, baudRate: BAUD_RATE, port: serialPath, lastError: 'Serial port closed' });
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

let internalReady = 0;
const expectedInternalServers = secureServer ? 2 : 1;

function maybeStartPublicMux() {
  internalReady += 1;
  if (internalReady !== expectedInternalServers) return;

  const mux = net.createServer((clientSocket) => {
    clientSocket.once('data', (firstChunk) => {
      const looksLikeTls = firstChunk.length > 0 && firstChunk[0] === 0x16;
      const targetPort = looksLikeTls ? HTTPS_INTERNAL_PORT : HTTP_INTERNAL_PORT;
      const upstream = net.connect(targetPort, '127.0.0.1', () => {
        upstream.write(firstChunk);
        clientSocket.pipe(upstream);
        upstream.pipe(clientSocket);
      });
      const closeBoth = () => {
        if (!clientSocket.destroyed) clientSocket.destroy();
        if (!upstream.destroyed) upstream.destroy();
      };
      upstream.on('error', closeBoth);
      clientSocket.on('error', closeBoth);
    });
  });

  mux.listen(PUBLIC_PORT, '0.0.0.0', () => {
    console.log(`[AIS] AIS server started on ${PUBLIC_PORT}`);
    console.log(`[AIS] Windows endpoint: ws://10.129.4.102:${PUBLIC_PORT}`);
    if (secureServer) console.log(`[AIS] iOS endpoint: wss://10.129.4.102:${PUBLIC_PORT}`);
    console.log('[AIS] Plain WS and secure WSS share network port 8081.');
    console.log(`[EGC] Watching ${EGC_DIR} recursively through AIS WebSocket ${PUBLIC_PORT}`);
    scanEgcDirectory(true);
    setInterval(() => scanEgcDirectory(false), EGC_SCAN_INTERVAL_MS);
    openSerial();
  });
}

httpServer.listen(HTTP_INTERNAL_PORT, '127.0.0.1', maybeStartPublicMux);
if (secureServer) secureServer.listen(HTTPS_INTERNAL_PORT, '127.0.0.1', maybeStartPublicMux);
