const AIS_WS_HOST_KEY = "navdash-ais-ws-host";
const AIS_WS_PORT = 8443;
const WHEELHOUSE_AIS_WS_HOST = "ais.wardlab.dev";
const WHEELHOUSE_AIS_WS_URL = `wss://${WHEELHOUSE_AIS_WS_HOST}:${AIS_WS_PORT}`;
const LEGACY_WHEELHOUSE_AIS_WS_URL = "ws://10.129.4.102:8081";

function isLocalAisUrl(url: string) {
  return /^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(url.trim());
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
    const hasPort = /:\d+$/.test(queryHost);
    const url = queryHost.includes("://")
      ? queryHost
      : `wss://${queryHost}${hasPort ? "" : `:${AIS_WS_PORT}`}`;
    window.localStorage.setItem(AIS_WS_HOST_KEY, url);
    return url;
  }

  const storedUrl = window.localStorage.getItem(AIS_WS_HOST_KEY)?.trim();
  if (storedUrl === LEGACY_WHEELHOUSE_AIS_WS_URL) {
    window.localStorage.setItem(AIS_WS_HOST_KEY, WHEELHOUSE_AIS_WS_URL);
    return WHEELHOUSE_AIS_WS_URL;
  }

  if (storedUrl && !isLocalAisUrl(storedUrl)) return storedUrl;

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
