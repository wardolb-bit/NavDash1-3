const AIS_WS_HOST_KEY = "navdash-ais-ws-host";
const CLOUD_AIS_WS_URL = "wss://uujlsvgromzapubtinfg.supabase.co/functions/v1/navdash-ais-relay?role=client";
const DIRECT_AIS_WS_URL = "navdash-realtime://navdash-ais-live";
const SUPABASE_REALTIME_URL = "wss://uujlsvgromzapubtinfg.supabase.co/realtime/v1/websocket?apikey=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1amxzdmdyb216YXB1YnRpbmZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNzczMTksImV4cCI6MjEwNDY1MzMxOX0.bl2O1EKgTiz1CWG1Y2tCFh9NYHW2ixQyowJGjdlOrBY&vsn=1.0.0";
const REALTIME_TOPIC = "realtime:navdash-ais-live";
const LEGACY_WHEELHOUSE_AIS_WS_URL = "ws://10.129.4.102:8081";
const LEGACY_SECURE_AIS_WS_URL = "wss://ais.wardlab.dev:8443";
const REALTIME_HEARTBEAT_MS = 15000;
const REALTIME_STALE_CHECK_MS = 3000;
const REALTIME_STALE_MS = 12000;

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
  if (normalized === LEGACY_WHEELHOUSE_AIS_WS_URL || normalized === LEGACY_SECURE_AIS_WS_URL) return true;

  try {
    const parsed = new URL(normalized);
    return parsed.hostname.toLowerCase() === "ais.wardlab.dev";
  } catch {
    return /^wss?:\/\/ais\.wardlab\.dev(?::\d+)?(?:\/.*)?$/i.test(normalized);
  }
}

function isOldCloudRelayUrl(url: string) {
  return url.trim().replace(/\/$/, "") === CLOUD_AIS_WS_URL;
}

export function getAisWebSocketUrl(defaultUrl = DIRECT_AIS_WS_URL) {
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
  if (storedUrl && (isLegacyAisUrl(storedUrl) || isOldCloudRelayUrl(storedUrl))) {
    window.localStorage.setItem(AIS_WS_HOST_KEY, DIRECT_AIS_WS_URL);
    return DIRECT_AIS_WS_URL;
  }

  if (storedUrl === DIRECT_AIS_WS_URL) return storedUrl;
  if (storedUrl && !isLocalAisUrl(storedUrl)) return storedUrl;

  if (storedUrl && isLocalAisUrl(storedUrl)) {
    window.localStorage.setItem(AIS_WS_HOST_KEY, DIRECT_AIS_WS_URL);
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
