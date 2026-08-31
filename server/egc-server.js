const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const WS_PORT = Number(process.env.EGC_WS_PORT || 8082);
const EGC_DIR =
  process.env.FELCOM_EGC_DIR ||
  'C:\\Users\\havennav\\Documents\\felcom19\\egc';
const SCAN_INTERVAL_MS = Number(process.env.EGC_SCAN_INTERVAL_MS || 5000);

const wss = new WebSocket.Server({ port: WS_PORT, host: '0.0.0.0' });

let messages = [];
let lastScanAt = null;
let lastError = null;
let lastSignature = '';

function parseReceivedAt(raw) {
  const match = String(raw || '').match(
    /(\d{2})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/
  );
  if (!match) return null;

  const [, yy, mm, dd, hh, minute] = match;
  const year = 2000 + Number(yy);
  const date = new Date(
    Date.UTC(year, Number(mm) - 1, Number(dd), Number(hh), Number(minute))
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function headerField(text, label) {
  const pattern = new RegExp(`^${label}\\s*:\\s*(.+)$`, 'mi');
  return text.match(pattern)?.[1]?.trim() || '';
}

function parseEgcFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  const firstLine = lines[0]?.trim() || '';
  const type =
    firstLine.match(/^EGC Message\s+---\s+(.+?)\s+---\s*$/i)?.[1]?.trim() ||
    'EGC Message';

  const separatorIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === ''
  );
  const body = (separatorIndex >= 0 ? lines.slice(separatorIndex + 1) : lines)
    .join('\n')
    .trim();

  const sequence = headerField(raw, 'Message Sequence No\\.');
  const les = headerField(raw, 'LES');
  const priority = headerField(raw, 'Priority');
  const size = headerField(raw, 'Size');
  const receiveText = headerField(raw, 'Receive Date & Time');
  const receivedAt = parseReceivedAt(receiveText);

  const navMatch = body.match(/\bNAVAREA\s+([IVXLC]+)\s+(\d+\/\d+)\b/i);
  const cancellationMatch = body.match(/\bCANCEL(?:S|LED|LED)?\s+NAVAREA\s+([IVXLC]+)\s+(\d+\/\d+)\b/i);

  return {
    id: `${path.basename(filePath)}:${sequence || fs.statSync(filePath).mtimeMs}`,
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
    modifiedAt: fs.statSync(filePath).mtime.toISOString()
  };
}

function getSnapshot() {
  return {
    type: 'egc-snapshot',
    connected: true,
    directory: EGC_DIR,
    scannedAt: lastScanAt,
    lastError,
    messages
  };
}

function sendSnapshot(ws) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(getSnapshot()));
  }
}

function broadcastSnapshot() {
  const payload = JSON.stringify(getSnapshot());
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

function scanEgcDirectory(forceBroadcast = false) {
  try {
    if (!fs.existsSync(EGC_DIR)) {
      throw new Error(`FELCOM EGC folder not found: ${EGC_DIR}`);
    }

    const entries = fs
      .readdirSync(EGC_DIR, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => path.join(EGC_DIR, entry.name));

    const parsed = [];
    for (const filePath of entries) {
      try {
        const item = parseEgcFile(filePath);
        if (item.body || item.sequence) parsed.push(item);
      } catch (error) {
        console.log(`[EGC] Skipping ${path.basename(filePath)}: ${error.message}`);
      }
    }

    parsed.sort((a, b) => {
      const aTime = Date.parse(a.receivedAt || a.modifiedAt || '') || 0;
      const bTime = Date.parse(b.receivedAt || b.modifiedAt || '') || 0;
      return bTime - aTime;
    });

    messages = parsed;
    lastScanAt = new Date().toISOString();
    lastError = null;

    const signature = JSON.stringify(
      messages.map(item => [item.filename, item.modifiedAt, item.sequence])
    );
    if (forceBroadcast || signature !== lastSignature) {
      lastSignature = signature;
      broadcastSnapshot();
    }
  } catch (error) {
    lastScanAt = new Date().toISOString();
    lastError = error.message;
    if (forceBroadcast || lastError) broadcastSnapshot();
  }
}

wss.on('connection', ws => {
  sendSnapshot(ws);

  ws.on('message', raw => {
    try {
      const message = JSON.parse(String(raw));
      if (message?.type === 'egc-refresh') {
        scanEgcDirectory(true);
        sendSnapshot(ws);
      }
    } catch {
      // Ignore malformed client messages.
    }
  });
});

console.log(`[EGC] FELCOM watcher started on ws://0.0.0.0:${WS_PORT}`);
console.log(`[EGC] Watching ${EGC_DIR}`);

scanEgcDirectory(true);
setInterval(() => scanEgcDirectory(false), SCAN_INTERVAL_MS);
