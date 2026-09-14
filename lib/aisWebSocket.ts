const AIS_WS_HOST_KEY = "navdash-ais-ws-host";
const CLOUD_AIS_WS_URL = "wss://uujlsvgromzapubtinfg.supabase.co/functions/v1/navdash-ais-relay?role=client";
const LEGACY_WHEELHOUSE_AIS_WS_URL = "ws://10.129.4.102:8081";
const LEGACY_SECURE_AIS_WS_URL = "wss://ais.wardlab.dev:8443";

function isLocalAisUrl(url: string) {
  return /^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(url.trim());
}

function isLegacyAisUrl(url: string) {
  const normalized = url.trim().replace(/\/$/, "");
  return normalized === LEGACY_WHEELHOUSE_AIS_WS_URL || normalized === LEGACY_SECURE_AIS_WS_URL;
}

export function getAisWebSocketUrl(defaultUrl = CLOUD_AIS_WS_URL) {
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
  if (storedUrl && isLegacyAisUrl(storedUrl)) {
    window.localStorage.setItem(AIS_WS_HOST_KEY, CLOUD_AIS_WS_URL);
    return CLOUD_AIS_WS_URL;
  }

  if (storedUrl && !isLocalAisUrl(storedUrl)) return storedUrl;

  if (storedUrl && isLocalAisUrl(storedUrl)) {
    window.localStorage.setItem(AIS_WS_HOST_KEY, CLOUD_AIS_WS_URL);
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
