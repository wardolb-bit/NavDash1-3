const AIS_WS_HOST_KEY = "navdash-ais-ws-host";
const LOCAL_AIS_WS_HOST = "127.0.0.1";
const AIS_WS_PORT = 8081;
const LOCAL_AIS_WS_URL = `ws://${LOCAL_AIS_WS_HOST}:${AIS_WS_PORT}`;
const ECR_DEFAULT_AIS_WS_URL = `ws://10.129.4.102:${AIS_WS_PORT}`;

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

  const storedUrl = window.localStorage.getItem(AIS_WS_HOST_KEY);
  if (storedUrl) return storedUrl;

  // The Vercel-hosted ECR display runs on a separate shipboard computer, so
  // localhost would point at the ECR itself. Seed it to the wheelhouse AIS
  // server while leaving the existing main-page/default behavior unchanged.
  if (window.location.pathname === "/ecr" || window.location.pathname.startsWith("/ecr/")) {
    window.localStorage.setItem(AIS_WS_HOST_KEY, ECR_DEFAULT_AIS_WS_URL);
    return ECR_DEFAULT_AIS_WS_URL;
  }

  return LOCAL_AIS_WS_URL;
}

export function clearAisWebSocketOverride() {
  window.localStorage.removeItem(AIS_WS_HOST_KEY);
}
