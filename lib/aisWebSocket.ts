const AIS_WS_HOST_KEY = "navdash-ais-ws-host";
const CLOUD_AIS_WS_URL = "wss://uujlsvgromzapubtinfg.supabase.co/functions/v1/navdash-ais-relay?role=client";

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
  if (storedUrl !== CLOUD_AIS_WS_URL) {
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
