const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');

const WSS_PORT = Number(process.env.AIS_WSS_PORT || 8081);
const BACKEND_PORT = Number(process.env.AIS_BACKEND_PORT || 8080);
const BACKEND_URL = process.env.AIS_BACKEND_URL || `ws://127.0.0.1:${BACKEND_PORT}`;
const HOST = process.env.AIS_WSS_HOST || '0.0.0.0';

function isFile(filePath) {
  try {
    return Boolean(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readPemType(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    if (/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(text)) return 'key';
    if (/-----BEGIN CERTIFICATE-----/.test(text)) return 'cert';
  } catch {
    // Not a readable PEM file.
  }
  return null;
}

function walkForPem(root, maxDepth = 3) {
  const found = [];
  if (!root || !fs.existsSync(root)) return found;

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!/node_modules|\.git|\.next|dist|build/i.test(entry.name)) walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !/\.(pem|crt|cer|key)$/i.test(entry.name)) continue;
      const type = readPemType(fullPath);
      if (type) found.push({ path: fullPath, type });
    }
  }

  walk(root, 0);
  return found;
}

function scoreCandidate(filePath) {
  const name = filePath.toLowerCase();
  let score = 0;
  if (name.includes('navdash')) score += 100;
  if (name.includes('ipad')) score += 50;
  if (name.includes('10.129.4.102')) score += 50;
  if (name.includes('ais')) score += 25;
  if (name.includes('server')) score += 10;
  if (name.includes('certs') || name.includes('certificate')) score += 10;
  return score;
}

function findTlsPair() {
  const explicitKey = process.env.AIS_TLS_KEY;
  const explicitCert = process.env.AIS_TLS_CERT;
  if (isFile(explicitKey) && isFile(explicitCert)) {
    return { keyPath: explicitKey, certPath: explicitCert, source: 'AIS_TLS_KEY/AIS_TLS_CERT' };
  }

  const appRoot = path.resolve(__dirname, '..');
  const documentsRoot = path.join(os.homedir(), 'Documents');
  const roots = [
    process.env.AIS_TLS_DIR,
    path.join(appRoot, 'certs'),
    path.join(__dirname, 'certs'),
    appRoot,
    __dirname,
    path.join(documentsRoot, 'NavDash-iPad-client'),
    path.join(documentsRoot, 'NavDash'),
    path.join(documentsRoot, 'navdash-certs'),
    documentsRoot
  ].filter(Boolean);

  const seen = new Set();
  const candidates = roots
    .flatMap(root => walkForPem(root, root === documentsRoot ? 3 : 4))
    .filter(item => {
      const key = item.path.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const keys = candidates.filter(item => item.type === 'key');
  const certs = candidates.filter(item => item.type === 'cert');

  const pairs = [];
  for (const key of keys) {
    for (const cert of certs) {
      let score = scoreCandidate(key.path) + scoreCandidate(cert.path);
      if (path.dirname(key.path) === path.dirname(cert.path)) score += 100;
      pairs.push({ keyPath: key.path, certPath: cert.path, score });
    }
  }

  pairs.sort((a, b) => b.score - a.score);
  if (pairs[0]) return { ...pairs[0], source: 'automatic certificate discovery' };
  return null;
}

const tlsPair = findTlsPair();
if (!tlsPair) {
  console.error('[AIS-WSS] No TLS certificate/key pair found.');
  console.error('[AIS-WSS] Set AIS_TLS_CERT and AIS_TLS_KEY to the existing iPad-trusted server certificate files.');
  console.error('[AIS-WSS] The AIS/EGC backend can still run locally, but iPad WSS will not start.');
  process.exit(1);
}

let key;
let cert;
try {
  key = fs.readFileSync(tlsPair.keyPath);
  cert = fs.readFileSync(tlsPair.certPath);
} catch (error) {
  console.error(`[AIS-WSS] Could not read TLS files: ${error.message}`);
  process.exit(1);
}

const httpsServer = https.createServer({ key, cert }, (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({
      ok: true,
      service: 'NavDash AIS WSS bridge',
      backend: BACKEND_URL,
      port: WSS_PORT
    }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

const wss = new WebSocket.Server({ server: httpsServer });

wss.on('connection', client => {
  const backend = new WebSocket(BACKEND_URL);
  const pending = [];

  backend.on('open', () => {
    while (pending.length && backend.readyState === WebSocket.OPEN) {
      backend.send(pending.shift());
    }
  });

  backend.on('message', data => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });

  backend.on('error', error => {
    console.log(`[AIS-WSS] Backend connection error: ${error.message}`);
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'status', connected: false, lastError: `WSS bridge backend: ${error.message}` }));
    }
  });

  backend.on('close', () => {
    if (client.readyState === WebSocket.OPEN) client.close(1011, 'AIS backend disconnected');
  });

  client.on('message', data => {
    if (backend.readyState === WebSocket.OPEN) backend.send(data);
    else if (backend.readyState === WebSocket.CONNECTING) pending.push(data);
  });

  client.on('close', () => {
    if (backend.readyState === WebSocket.OPEN || backend.readyState === WebSocket.CONNECTING) backend.close();
  });

  client.on('error', () => {
    if (backend.readyState === WebSocket.OPEN || backend.readyState === WebSocket.CONNECTING) backend.close();
  });
});

httpsServer.on('tlsClientError', error => {
  console.log(`[AIS-WSS] TLS client error: ${error.message}`);
});

httpsServer.listen(WSS_PORT, HOST, () => {
  console.log(`[AIS-WSS] Secure WebSocket listening on wss://${HOST}:${WSS_PORT}`);
  console.log(`[AIS-WSS] Relaying AIS + EGC from ${BACKEND_URL}`);
  console.log(`[AIS-WSS] Certificate: ${tlsPair.certPath}`);
  console.log(`[AIS-WSS] Private key: ${tlsPair.keyPath}`);
  console.log(`[AIS-WSS] TLS source: ${tlsPair.source}`);
});
