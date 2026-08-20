const AIS_WS_HOST_KEY = "navdash-ais-ws-host";

export function getAisWebSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
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
      : `${protocol}//${queryHost}${hasPort ? "" : ":8081"}`;
    window.localStorage.setItem(AIS_WS_HOST_KEY, url);
    return url;
  }

  return window.localStorage.getItem(AIS_WS_HOST_KEY) || `${protocol}//${window.location.hostname}:8081`;
}

export function clearAisWebSocketOverride() {
  window.localStorage.removeItem(AIS_WS_HOST_KEY);
}
