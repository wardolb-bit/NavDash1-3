import { NextRequest, NextResponse } from 'next/server';
import { resolve4, resolve6, resolveMx, resolveNs, resolveTxt, resolveCaa } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as https from 'node:https';
import * as tls from 'node:tls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const windows = new Map<string, { count: number; start: number }>();
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function domain(raw: unknown) {
  if (typeof raw !== 'string' || raw.length > 300) throw new Error('Enter a domain such as wardlab.dev.');
  const value = raw.trim();
  const url = new URL(value.includes('://') ? value : `https://${value}`);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.username || url.password || (url.port && url.port !== '443') || !['https:', 'http:'].includes(url.protocol)) throw new Error('Use a domain on the standard HTTPS port.');
  if (isIP(host) || !host.includes('.') || host.length > 253 || !host.split('.').every(p => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(p))) throw new Error('Enter a fully qualified domain name, not an IP address.');
  if (/\.(localhost|local|internal|test|invalid|example|home|lan)$/.test(host)) throw new Error('Use a public domain. Local targets belong in the companion.');
  return host;
}

// Public HTTPS requests use this exact resolved address, preventing DNS rebinding.
function publicV4(ip: string) {
  if (isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}

async function addressFor(host: string) {
  const addresses = await resolve4(host);
  if (!addresses.length || addresses.some(ip => !publicV4(ip))) throw new Error('Target must resolve only to public IPv4 addresses. IPv6-only HTTPS targets are not supported yet.');
  return addresses[0];
}

async function dnsReport(host: string) {
  const queries = { A: () => resolve4(host), AAAA: () => resolve6(host), MX: () => resolveMx(host), NS: () => resolveNs(host), TXT: () => resolveTxt(host), CAA: () => resolveCaa(host), DMARC: () => resolveTxt(`_dmarc.${host}`) };
  const records = await Promise.all(Object.entries(queries).map(async ([type, query]) => {
    try { return { type, values: await query(), status: 'answered' }; }
    catch (err) { const code = (err as NodeJS.ErrnoException).code; return { type, values: [], status: code === 'ENODATA' || code === 'ENOTFOUND' ? 'no records' : 'lookup failed', code }; }
  }));
  return { host, records, note: 'Mail policy records are shown for this exact domain. DNS results alone do not establish that a domain is secure.' };
}

function headerReport(host: string, ip: string) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const req = https.request({ hostname: host, servername: host, port: 443, path: '/', method: 'HEAD', family: 4, agent: false, rejectUnauthorized: true, maxHeaderSize: 32768, lookup: (_host, _options, callback) => callback(null, ip, 4), headers: { 'User-Agent': 'WardLab-Network/1.0', Accept: '*/*' } }, res => {
      const names = ['strict-transport-security', 'content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy'];
      const checks = names.map(name => ({ name, value: res.headers[name] || null }));
      const cookies = (res.headers['set-cookie'] || []).map(cookie => {
        const parts = cookie.split(';').map(v => v.trim());
        return { name: parts[0].split('=')[0], secure: parts.some(v => /^secure$/i.test(v)), httpOnly: parts.some(v => /^httponly$/i.test(v)), sameSite: parts.find(v => /^samesite=/i.test(v))?.split('=')[1] || null };
      });
      res.resume();
      resolve({ host, address: ip, status: res.statusCode, elapsedMs: Date.now() - start, checks, cookies, redirect: res.headers.location || null, note: 'Checks the HTTPS root response using HEAD. Redirects are displayed, not followed. Header presence is a configuration hint, not a vulnerability verdict.' });
    });
    req.setTimeout(8000, () => req.destroy(new Error('HTTPS request timed out.')));
    req.on('error', reject);
    req.end();
  });
}

function certificateReport(host: string, ip: string) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: ip, servername: host, port: 443, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      if (!cert || !cert.valid_to) { socket.destroy(); reject(new Error('No peer certificate received.')); return; }
      const hostnameError = tls.checkServerIdentity(host, cert);
      const expires = Date.parse(cert.valid_to);
      resolve({ host, address: ip, trusted: socket.authorized, authorizationError: socket.authorized ? null : String(socket.authorizationError || 'Untrusted chain'), hostnameMatches: !hostnameError, subject: cert.subject, issuer: cert.issuer, validFrom: cert.valid_from, validTo: cert.valid_to, daysRemaining: Math.floor((expires - Date.now()) / 86400000), subjectAltName: cert.subjectaltname, fingerprint: cert.fingerprint256, protocol: socket.getProtocol(), cipher: socket.getCipher().name, note: 'Inspects the presented certificate and this connection. This is not a full TLS configuration or cipher-suite audit.' });
      socket.end(); socket.destroy();
    });
    socket.setTimeout(8000, () => socket.destroy(new Error('TLS connection timed out.')));
    socket.on('error', reject);
  });
}

export async function POST(req: NextRequest) {
  const now = Date.now();
  for (const [key, value] of windows) if (now - value.start > 60000) windows.delete(key);
  const key = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const window = windows.get(key) || { count: 0, start: now };
  window.count++; windows.set(key, window);
  if (window.count > 20 || windows.size > 5000) return NextResponse.json({ error: 'Too many checks. Try again in one minute.' }, { status: 429, headers });
  try {
    if (Number(req.headers.get('content-length') || 0) > 2048) throw new Error('Request is too large.');
    const text = await req.text();
    if (text.length > 2048) throw new Error('Request is too large.');
    const body = JSON.parse(text);
    const host = domain(body.target);
    if (!['dns', 'headers', 'tls'].includes(body.tool)) throw new Error('Unknown tool.');
    const work = async () => body.tool === 'dns' ? dnsReport(host) : body.tool === 'headers' ? headerReport(host, await addressFor(host)) : certificateReport(host, await addressFor(host));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Lookup timed out. Try again.')), 14000); })]);
      return NextResponse.json({ tool: body.tool, checkedAt: new Date().toISOString(), result }, { headers });
    } finally { clearTimeout(timer); }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Inspection failed.';
    return NextResponse.json({ error: message.slice(0, 240) }, { status: 400, headers });
  }
}
