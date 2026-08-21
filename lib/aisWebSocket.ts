const AIS_WS_HOST_KEY = "navdash-ais-ws-host";
const LOCAL_AIS_WS_HOST = "127.0.0.1";
const WHEELHOUSE_AIS_WS_HOST = "10.129.4.102";
const AIS_WS_PORT = 8081;
const LOCAL_AIS_WS_URL = `ws://${LOCAL_AIS_WS_HOST}:${AIS_WS_PORT}`;
const WHEELHOUSE_AIS_WS_URL = `ws://${WHEELHOUSE_AIS_WS_HOST}:${AIS_WS_PORT}`;

function isPrivateNetworkHost(host: string) {
  const hostname = host
    .replace(/^wss?:\/\//i, "")
    .split("/")[0]
    .split(":")[0]
    .toLowerCase();

  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;

  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;

  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

export function getAisWebSocketUrl() {
  const params = new URLSearchParams(window.location.search);
  const queryUrl = params.get("aisWs")?.trim();
  const queryHost = params.get("aisHost")?.trim();

  if (queryUrl) {
    window.localStorage.setItem(AIS_WS_HOST_KEY, queryUrl);
    return queryUrl;
  }

  if (queryHost) {
    const protocol = isPrivateNetworkHost(queryHost)
      ? "ws:"
      : window.location.protocol === "https:"
        ? "wss:"
        : "ws:";
    const hasPort = /:\d+$/.test(queryHost);
    const url = queryHost.includes("://")
      ? queryHost
      : `${protocol}//${queryHost}${hasPort ? "" : `:${AIS_WS_PORT}`}`;
    window.localStorage.setItem(AIS_WS_HOST_KEY, url);
    return url;
  }

  const savedOverride = window.localStorage.getItem(AIS_WS_HOST_KEY);
  if (savedOverride) return savedOverride;

  const pageHost = window.location.hostname.toLowerCase();
  const runningLocally = pageHost === "localhost" || pageHost === "127.0.0.1";

  return runningLocally ? LOCAL_AIS_WS_URL : WHEELHOUSE_AIS_WS_URL;
}

export function clearAisWebSocketOverride() {
  window.localStorage.removeItem(AIS_WS_HOST_KEY);
}
