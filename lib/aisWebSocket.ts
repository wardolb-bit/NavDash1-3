const AIS_WS_HOST_KEY = "navdash-ais-ws-host";
const CLOUD_AIS_WS_URL = "wss://uujlsvgromzapubtinfg.supabase.co/functions/v1/navdash-ais-relay?role=client";
const DIRECT_AIS_WS_URL = "navdash-realtime://navdash-ais-live";
const TUNNEL_AIS_WS_URL = "wss://ais.wardlab.dev";
const SUPABASE_REALTIME_URL = "wss://uujlsvgromzapubtinfg.supabase.co/realtime/v1/websocket?apikey=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6InV1amxzdmdyb216YXB1YnRpbmZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNzczMTksImV4cCI6MjEwNDY1MzMxOX0.bl2O1EKgTiz1CWG1Y2tCFh9NYHW2ixQyowJGjdlOrBY&vsn=1.0.0";
const REALTIME_TOPIC = "realtime:navdash-ais-live";
const LEGACY_WHEELHOUSE_AIS_WS_URL = "ws://10.129.4.102:8081";
const LEGACY_SECURE_AIS_WS_URL = "wss://ais.wardlab.dev:8443";
const REALTIME_HEARTBEAT_MS = 15000;
const REALTIME_STALE_CHECK_MS = 3000;
const REALTIME_STALE_MS = 12000;

function isTunnelAisUrl(url: string) {
  try {
    return new URL(url).hostname.toLowerCase() === "ais.wardlab.dev";
  } catch {
    return /^wss?:\/\/ais\.wardlab\.dev(?::\d+)?(?:\/.*)?$/i.test(url.trim());
  }
}

function setUnsigned(bits: string[], start: number, length: number, value: number) {
  const max = 2 ** length - 1;
  const safe = Math.max(0, Math.min(max, Math.round(value)));
  const binary = safe.toString(2).padStart(length, "0");
  for (let index = 0; index < length; index += 1) bits[start + index] = binary[index];
}

function setSigned(bits: string[], start: number, length: number, value: number) {
  const min = -(2 ** (length - 1));
  const max = 2 ** (length - 1) - 1;
  const safe = Math.max(min, Math.min(max, Math.round(value)));
  setUnsigned(bits, start, length, safe < 0 ? 2 ** length + safe : safe);
}

function positionToAivdo(lat: number, lon: number, sog = 0, cog = 0, heading: number | null = null) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  const bits = Array(168).fill("0") as string[];
  setUnsigned(bits, 0, 6, 1);
  setUnsigned(bits, 6, 2, 0);
  setUnsigned(bits, 8, 30, 0);
  setUnsigned(bits, 38, 4, 15);
  setUnsigned(bits, 42, 8, 128);
  setUnsigned(bits, 50, 10, Math.max(0, Math.min(1022, sog * 10)));
  setUnsigned(bits, 60, 1, 1);
  setSigned(bits, 61, 28, lon * 600000);
  setSigned(bits, 89, 27, lat * 600000);
  setUnsigned(bits, 116, 12, Math.max(0, Math.min(3599, cog * 10)));
  setUnsigned(bits, 128, 9, heading == null || !Number.isFinite(heading) ? 511 : Math.max(0, Math.min(359, heading)));
  setUnsigned(bits, 137, 6, 60);

  let payload = "";
  for (let index = 0; index < bits.length; index += 6) {
    const value = parseInt(bits.slice(index, index + 6).join(""), 2);
    payload += String.fromCharCode(value < 40 ? value + 48 : value + 56);
  }
  return `!AIVDO,1,1,,A,${payload},0`;
}

function decodedPositionFromObject(value: any, allowUnmarked = false) {
  if (!value || typeof value !== "object") return null;
  const marker = String(value.type ?? value.kind ?? value.event ?? value.messageType ?? "").toLowerCase();
  const isPosition = marker.includes("position") || marker.includes("ownship") || marker.includes("own_ship") || marker.includes("own-ship") || marker === "gps";
  if (!allowUnmarked && !isPosition) return null;

  const lat = Number(value.lat ?? value.latitude ?? value.position?.lat ?? value.position?.latitude);
  const lon = Number(value.lon ?? value.lng ?? value.longitude ?? value.position?.lon ?? value.position?.lng ?? value.position?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const sog = Number(value.sog ?? value.speed ?? value.position?.sog ?? 0);
  const cog = Number(value.cog ?? value.course ?? value.position?.cog ?? 0);
  const rawHeading = value.heading ?? value.hdg ?? value.position?.heading;
  const heading = rawHeading == null ? null : Number(rawHeading);
  return positionToAivdo(lat, lon, Number.isFinite(sog) ? sog : 0, Number.isFinite(cog) ? cog : 0, heading != null && Number.isFinite(heading) ? heading : null);
}

function normalizeTunnelMessage(data: unknown) {
  const raw = typeof data === "string" ? data : String(data ?? "");
  if (!raw || raw.includes("!AIVDO")) return raw;

  const logMatch = raw.match(/\[POSITION\]\s+AIVDO\s+(-?\d+(?:\.\d+)?)\s*,?\s+(-?\d+(?:\.\d+)?)/i);
  if (logMatch) {
    const aivdo = positionToAivdo(Number(logMatch[1]), Number(logMatch[2]));
    if (aivdo) return aivdo;
  }

  try {
    const parsed = JSON.parse(raw);
    const marker = String(parsed?.type ?? parsed?.kind ?? parsed?.event ?? parsed?.messageType ?? "").toLowerCase();
    const parentOwnShip = marker.includes("ownship") || marker.includes("own_ship") || marker.includes("own-ship") || marker.includes("position") || marker === "gps";

    if (parentOwnShip) {
      const nestedCandidates = [
        parsed?.ownShip,
        parsed?.ownship,
        parsed?.position,
        parsed?.data?.ownShip,
        parsed?.data?.ownship,
        parsed?.data?.position,
        parsed?.payload?.ownShip,
        parsed?.payload?.ownship,
        parsed?.payload?.position,
        parsed?.data,
        parsed?.payload,
      ];
      for (const candidate of nestedCandidates) {
        const aivdo = decodedPositionFromObject(candidate, true);
        if (aivdo) return aivdo;
      }
    }

    const candidates = [parsed, parsed?.data, parsed?.payload, parsed?.position, parsed?.ownShip, parsed?.ownship];
    for (const candidate of candidates) {
      const aivdo = decodedPositionFromObject(candidate);
      if (aivdo) return aivdo;
    }
  } catch {}

  return raw;
}

class TunnelAisSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly extensions = "";
  readonly protocol = "";
  binaryType: BinaryType = "blob";
  bufferedAmount = 0;
  readyState = TunnelAisSocket.CONNECTING;
  onopen: ((this: WebSocket, ev: Event) => any) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null = null;
  onerror: ((this: WebSocket, ev: Event) => any) | null = null;
  onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null;

  private socket: WebSocket;
  readonly url: string;

  constructor(NativeWebSocket: typeof WebSocket, url: string | URL, protocols?: string | string[]) {
    super();
    this.url = String(url);
    this.socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);

    this.socket.onopen = () => {
      this.readyState = TunnelAisSocket.OPEN;
      const openEvent = new Event("open");
      this.onopen?.call(this as any, openEvent);
      this.dispatchEvent(openEvent);
    };
    this.socket.onmessage = (event) => {
      const messageEvent = new MessageEvent("message", { data: normalizeTunnelMessage(event.data) });
      this.onmessage?.call(this as any, messageEvent);
      this.dispatchEvent(messageEvent);
    };
    this.socket.onerror = () => {
      const errorEvent = new Event("error");
      this.onerror?.call(this as any, errorEvent);
      this.dispatchEvent(errorEvent);
    };
    this.socket.onclose = (event) => {
      this.readyState = TunnelAisSocket.CLOSED;
      const closeEvent = new CloseEvent("close", { code: event.code, reason: event.reason, wasClean: event.wasClean });
      this.onclose?.call(this as any, closeEvent);
      this.dispatchEvent(closeEvent);
    };
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    this.socket.send(data as any);
  }

  close(code?: number, reason?: string) {
    this.readyState = TunnelAisSocket.CLOSING;
    this.socket.close(code, reason);
  }
}

class DirectAisRealtimeSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url = DIRECT_AIS_WS_URL;
  readonly extensions = "";
  readonly protocol = "";
  binaryType: BinaryType = "blob";
  bufferedAmount = 0;
  readyState = DirectAisRealtimeSocket.CONNECTING;

  onopen: ((this: WebSocket, ev: Event) => any) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null = null;
  onerror: ((this: WebSocket, ev: Event) => any) | null = null;
  onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null;

  private socket: WebSocket;
  private heartbeatTimer = 0;
  private staleTimer = 0;
  private ref = 1;
  private readonly joinRef = "1";
  private opened = false;
  private lastAisAt = 0;

  constructor(NativeWebSocket: typeof WebSocket) {
    super();
    this.socket = new NativeWebSocket(SUPABASE_REALTIME_URL);

    this.socket.onopen = () => {
      this.push("phx_join", {
        config: {
          broadcast: { ack: false, self: false },
          presence: { enabled: false },
          postgres_changes: [],
          private: false,
        },
      }, this.joinRef, this.joinRef);
    };

    this.socket.onmessage = (event) => {
      let message: any;
      try { message = JSON.parse(String(event.data || "")); } catch { return; }

      if (message?.event === "phx_reply" && String(message?.ref || "") === this.joinRef) {
        if (message?.payload?.status === "ok") {
          this.readyState = DirectAisRealtimeSocket.OPEN;
          this.opened = true;
          this.lastAisAt = Date.now();
          this.startHeartbeat();
          this.startStaleCheck();
          const openEvent = new Event("open");
          this.onopen?.call(this as any, openEvent);
          this.dispatchEvent(openEvent);
        } else {
          this.socket.close(1011, "realtime join failed");
        }
        return;
      }

      if (message?.event === "broadcast" && message?.payload?.type === "broadcast" && message?.payload?.event === "ais") {
        const data = message?.payload?.payload?.data;
        if (typeof data !== "string") return;
        this.lastAisAt = Date.now();
        const messageEvent = new MessageEvent("message", { data });
        this.onmessage?.call(this as any, messageEvent);
        this.dispatchEvent(messageEvent);
        return;
      }

      if (message?.event === "phx_error" || message?.event === "phx_close") {
        try { this.socket.close(1011, String(message.event)); } catch {}
      }
    };

    this.socket.onerror = () => {
      const errorEvent = new Event("error");
      this.onerror?.call(this as any, errorEvent);
      this.dispatchEvent(errorEvent);
    };

    this.socket.onclose = (event) => {
      this.stopHeartbeat();
      this.stopStaleCheck();
      this.readyState = DirectAisRealtimeSocket.CLOSED;
      const closeEvent = new CloseEvent("close", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
      this.onclose?.call(this as any, closeEvent);
      this.dispatchEvent(closeEvent);
    };
  }

  private push(event: string, payload: unknown, ref?: string, joinRef?: string | null) {
    if (this.socket.readyState !== this.socket.OPEN) return;
    const nextRef = ref || String(++this.ref);
    this.socket.send(JSON.stringify({
      topic: event === "heartbeat" ? "phoenix" : REALTIME_TOPIC,
      event,
      payload,
      ref: nextRef,
      join_ref: event === "heartbeat" ? null : (joinRef ?? this.joinRef),
    }));
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket.readyState !== this.socket.OPEN) return;
      this.push("heartbeat", {});
    }, REALTIME_HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = 0;
  }

  private startStaleCheck() {
    this.stopStaleCheck();
    this.staleTimer = window.setInterval(() => {
      if (this.readyState !== DirectAisRealtimeSocket.OPEN) return;
      if (document.visibilityState !== "visible") return;
      if (!this.lastAisAt || Date.now() - this.lastAisAt <= REALTIME_STALE_MS) return;
      try { this.socket.close(4000, "ais stream stale"); } catch {}
    }, REALTIME_STALE_CHECK_MS);
  }

  private stopStaleCheck() {
    if (this.staleTimer) window.clearInterval(this.staleTimer);
    this.staleTimer = 0;
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (this.readyState !== DirectAisRealtimeSocket.OPEN) {
      throw new DOMException("WebSocket is not open", "InvalidStateError");
    }
    const text = typeof data === "string" ? data : String(data);
    this.push("broadcast", {
      type: "broadcast",
      event: "control",
      payload: { data: text },
    });
  }

  close(code?: number, reason?: string) {
    if (this.readyState === DirectAisRealtimeSocket.CLOSED || this.readyState === DirectAisRealtimeSocket.CLOSING) return;
    this.readyState = DirectAisRealtimeSocket.CLOSING;
    this.stopHeartbeat();
    this.stopStaleCheck();
    if (this.opened && this.socket.readyState === this.socket.OPEN) {
      try { this.push("phx_leave", {}); } catch {}
    }
    try { this.socket.close(code, reason); } catch { this.readyState = DirectAisRealtimeSocket.CLOSED; }
  }
}

function installDirectAisWebSocketShim() {
  if (typeof window === "undefined") return;
  const globalWindow = window as any;
  if (globalWindow.__navdashDirectAisWebSocketShimInstalled) return;

  const NativeWebSocket = window.WebSocket;
  const WrappedWebSocket = function(url: string | URL, protocols?: string | string[]) {
    const requestedUrl = String(url);
    if (requestedUrl === DIRECT_AIS_WS_URL) {
      return new DirectAisRealtimeSocket(NativeWebSocket) as any;
    }
    if (isTunnelAisUrl(requestedUrl)) {
      return new TunnelAisSocket(NativeWebSocket, url, protocols) as any;
    }
    return protocols === undefined
      ? new NativeWebSocket(url)
      : new NativeWebSocket(url, protocols);
  } as any;

  WrappedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
  WrappedWebSocket.OPEN = NativeWebSocket.OPEN;
  WrappedWebSocket.CLOSING = NativeWebSocket.CLOSING;
  WrappedWebSocket.CLOSED = NativeWebSocket.CLOSED;
  WrappedWebSocket.prototype = NativeWebSocket.prototype;

  window.WebSocket = WrappedWebSocket as typeof WebSocket;
  globalWindow.__navdashDirectAisWebSocketShimInstalled = true;
}

installDirectAisWebSocketShim();

function isLocalAisUrl(url: string) {
  return /^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(url.trim());
}

function isLegacyAisUrl(url: string) {
  const normalized = url.trim().replace(/\/$/, "");
  return normalized === LEGACY_WHEELHOUSE_AIS_WS_URL || normalized === LEGACY_SECURE_AIS_WS_URL;
}

function isOldCloudRelayUrl(url: string) {
  return url.trim().replace(/\/$/, "") === CLOUD_AIS_WS_URL;
}

export function getAisWebSocketUrl(defaultUrl = TUNNEL_AIS_WS_URL) {
  const params = new URLSearchParams(window.location.search);
  const queryUrl = params.get("aisWs")?.trim();
  const queryHost = params.get("aisHost")?.trim();

  if (queryUrl) {
    window.localStorage.setItem(AIS_WS_HOST_KEY, queryUrl);
    return queryUrl;
  }

  if (queryHost) {
    const url = queryHost.includes("://") ? queryHost : `wss://${queryHost}`;
    window.localStorage.setItem(AIS_WS_HOST_KEY, url);
    return url;
  }

  const storedUrl = window.localStorage.getItem(AIS_WS_HOST_KEY)?.trim();
  if (storedUrl && (isLegacyAisUrl(storedUrl) || isOldCloudRelayUrl(storedUrl) || storedUrl === DIRECT_AIS_WS_URL)) {
    window.localStorage.setItem(AIS_WS_HOST_KEY, TUNNEL_AIS_WS_URL);
    return TUNNEL_AIS_WS_URL;
  }

  if (storedUrl && !isLocalAisUrl(storedUrl)) return storedUrl;

  if (storedUrl && isLocalAisUrl(storedUrl)) {
    window.localStorage.setItem(AIS_WS_HOST_KEY, TUNNEL_AIS_WS_URL);
  }

  return defaultUrl;
}

export function getEgcWebSocketUrl() {
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get("egcWs")?.trim();
  if (explicit) return explicit;

  return getAisWebSocketUrl();
}

export function clearAisWebSocketOverride() {
  window.localStorage.removeItem(AIS_WS_HOST_KEY);
}
