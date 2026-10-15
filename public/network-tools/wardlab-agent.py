#!/usr/bin/env python3
"""WardLab loopback-only network workbench. Python 3.9+, standard library only."""
import concurrent.futures
import ipaddress
import json
import secrets
import socket
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

TOKEN = secrets.token_urlsafe(32)
ROOT = Path(__file__).resolve().parent
PRIVATE = [ipaddress.ip_network(n) for n in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')]
SCAN_LOCK = threading.Lock()


def scan_input(cidr, ports):
    net = ipaddress.ip_network(str(cidr).strip(), strict=False)
    if net.version != 4 or net.prefixlen < 24 or not any(net.subnet_of(n) for n in PRIVATE):
        raise ValueError('Choose an RFC1918 private IPv4 network of /24 or smaller, or one host.')
    selected = sorted(set(int(p.strip()) for p in str(ports).split(',')))
    if not 1 <= len(selected) <= 16 or any(p < 1 or p > 65535 for p in selected):
        raise ValueError('Choose 1 to 16 TCP ports, between 1 and 65535.')
    return net, selected


def check_host(ip, ports):
    opened = []
    for port in ports:
        try:
            with socket.create_connection((str(ip), port), timeout=0.4):
                opened.append(port)
        except OSError:
            pass
    return {'ip': str(ip), 'ports': opened} if opened else None


def scan(cidr, ports):
    net, selected = scan_input(cidr, ports)
    addresses = list(net.hosts())
    start = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=32) as pool:
        devices = [device for device in pool.map(lambda ip: check_host(ip, selected), addresses) if device]
    return {'cidr': str(net), 'ports': selected, 'scanned': len(addresses), 'devices': devices, 'elapsedSeconds': round(time.monotonic() - start, 1)}


def suggested_network():
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = ipaddress.ip_address(info[4][0])
            if any(ip in n for n in PRIVATE):
                return str(ipaddress.ip_network(str(ip) + '/24', strict=False))
    except OSError:
        pass
    return '192.168.1.0/24'


class Handler(BaseHTTPRequestHandler):
    server_version = 'WardLab/1.0'
    sys_version = ''

    def log_message(self, *_args):
        pass

    def allowed_host(self):
        return self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}')

    def send_data(self, status, data, content_type='application/json'):
        if not isinstance(data, bytes):
            data = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if not self.allowed_host():
            self.send_data(403, {'error': 'Invalid Host header.'})
            return
        if self.path == '/api/session':
            self.send_data(200, {'token': TOKEN, 'suggestedCidr': suggested_network()})
            return
        filename = {'/': 'index.html', '/network': 'index.html', '/network-tools/index.html': 'index.html', '/network-tools/app.js': 'app.js', '/network-tools/style.css': 'style.css'}.get(self.path)
        if not filename:
            self.send_data(404, {'error': 'Not found.'})
            return
        mime = {'index.html': 'text/html; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8', 'style.css': 'text/css; charset=utf-8'}[filename]
        try:
            self.send_data(200, (ROOT / filename).read_bytes(), mime)
        except OSError:
            self.send_data(500, {'error': 'Companion assets are missing. Extract all files from the ZIP into one folder.'})

    def do_POST(self):
        if not self.allowed_host():
            self.send_data(403, {'error': 'Invalid Host header.'})
            return
        origin = self.headers.get('Origin')
        allowed_origins = (f'http://127.0.0.1:{self.server.server_port}', f'http://localhost:{self.server.server_port}')
        token = self.headers.get('X-WardLab-Token', '')
        if (origin and origin not in allowed_origins) or not secrets.compare_digest(token, TOKEN):
            self.send_data(403, {'error': 'Open the local workbench to start a check.'})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 2048:
                raise ValueError('Invalid request size.')
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError('Invalid request.')
            if self.path == '/api/scan':
                if not SCAN_LOCK.acquire(blocking=False):
                    self.send_data(409, {'error': 'A scan is already running. Wait for it to finish.'})
                    return
                try:
                    result = scan(body.get('cidr', ''), body.get('ports', ''))
                finally:
                    SCAN_LOCK.release()
                self.send_data(200, result)
            elif self.path == '/api/public':
                # Public-domain tools use WardLab; local scan results never leave this process.
                if body.get('tool') not in ('dns', 'headers', 'tls'):
                    raise ValueError('Unknown public tool.')
                request = urllib.request.Request('https://wardlab.dev/api/network', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'}, method='POST')
                try:
                    with urllib.request.urlopen(request, timeout=22) as response:
                        self.send_data(response.status, response.read(262144))
                except urllib.error.HTTPError as error:
                    self.send_data(error.code, error.read(262144))
            else:
                self.send_data(404, {'error': 'Not found.'})
        except (ValueError, TypeError, KeyError) as error:
            self.send_data(400, {'error': str(error)[:240]})
        except Exception:
            self.send_data(502, {'error': 'Could not complete the check. Check your connection and try again.'})


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.daemon_threads = True
    url = f'http://127.0.0.1:{server.server_port}/'
    print('\nWardLab Network Companion\n' + url + '\n\nKeep this window open. Press Ctrl+C to stop.\n')
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nCompanion stopped.')
    finally:
        server.server_close()
