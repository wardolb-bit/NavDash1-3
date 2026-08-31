const AIS_WS_HOST_KEY = "navdash-ais-ws-host";
const AIS_WS_PORT = 8081;
const WHEELHOUSE_AIS_WS_HOST = "10.129.4.102";
const WHEELHOUSE_AIS_WS_URL = `wss://${WHEELHOUSE_AIS_WS_HOST}:${AIS_WS_PORT}`;

function isLocalAisUrl(url: string) {
  return /^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(url.trim());
}

function normalizeAisHost(host: string) {
  const trimmed = host.trim();
  if (trimmed.includes("://")) return trimmed;

  const hasPort = /:\d+$/.test(trimmed);
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${trimmed}${hasPort ? "" : `:${AIS_WS_PORT}`}`;
}

export function getAisWebSocketUrl(defaultUrl = WHEELHOUSE_AIS_WS_URL) {
  const params = new URLSearchParams(window.location.search);
  const queryUrl = params.get("aisWs")?.trim();
  const queryHost = params.get("aisHost")?.trim();

  if (queryUrl) {
    window.localStorage.setItem(AIS_WS_HOST_KEY, queryUrl);
    return queryUrl;
  }

  if (queryHost) {
    const url = normalizeAisHost(queryHost);
    window.localStorage.setItem(AIS_WS_HOST_KEY, url);
    return url;
  }

  const storedUrl = window.localStorage.getItem(AIS_WS_HOST_KEY)?.trim();
  if (storedUrl && !isLocalAisUrl(storedUrl)) {
    if (window.location.protocol === "https:" && storedUrl.startsWith("ws://")) {
      const secureUrl = storedUrl.replace(/^ws:\/\//i, "wss://");
      window.localStorage.setItem(AIS_WS_HOST_KEY, secureUrl);
      return secureUrl;
    }
    return storedUrl;
  }

  if (storedUrl && isLocalAisUrl(storedUrl)) {
    window.localStorage.setItem(AIS_WS_HOST_KEY, WHEELHOUSE_AIS_WS_URL);
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
