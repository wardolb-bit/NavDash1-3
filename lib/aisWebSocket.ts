const AIS_WS_HOST_KEY = "navdash-ais-ws-host";
const LOCAL_AIS_WS_HOST = "127.0.0.1";
const AIS_WS_PORT = 8081;
const LOCAL_AIS_WS_URL = `ws://${LOCAL_AIS_WS_HOST}:${AIS_WS_PORT}`;

export function getAisWebSocketUrl() {
  const params = new URLSearchParams(window.location.search);
  const queryUrl = params.get("aisWs")?.trim();
  const queryHost = params.get("aisHost")?.trim();

  if (queryUrl) {
    window.localStorage.setItem(AIS_WS_HOST_KEY, queryUrl);
    return queryUrl;
  }

  if (queryHost) {
    const protocol = queryHost.includes("localhost") || queryHost.includes("127.0.0.1") ? "ws:" : window.location.protocol === "https:" ? "wss:" : "ws:";
    const hasPort = /:\d+$/.test(queryHost);
    const url = queryHost.includes("://")
      ? queryHost
      : `${protocol}//${queryHost}${hasPort ? "" : `:${AIS_WS_PORT}`}`;
    window.localStorage.setItem(AIS_WS_HOST_KEY, url);
    return url;
  }

  return window.localStorage.getItem(AIS_WS_HOST_KEY) || LOCAL_AIS_WS_URL;
}

export function clearAisWebSocketOverride() {
  window.localStorage.removeItem(AIS_WS_HOST_KEY);
}
