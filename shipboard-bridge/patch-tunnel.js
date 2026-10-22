"use strict";

const fs = require("fs");
const file = "NavDash-Shipboard-Bridge.js";
let source = fs.readFileSync(file, "utf8");

function replaceOnce(find, replacement, label) {
  const count = source.split(find).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  source = source.replace(find, replacement);
}

replaceOnce(
  "let cloudflaredProcess = null;",
  "let cloudflaredProcess = null;\nlet quickTunnelWebSocketUrl = null;",
  "cloudflared state",
);

replaceOnce(
  "publicWebSocketUrl: config.publicWebSocketUrl || null,",
  "publicWebSocketUrl: quickTunnelWebSocketUrl || config.publicWebSocketUrl || null,",
  "bridge public websocket URL",
);

replaceOnce(
  "cloudflareTunnelConfigured: Boolean(config.cloudflareTunnelToken),\n    cloudflareTunnelRunning: Boolean(cloudflaredProcess && !cloudflaredProcess.killed),",
  "cloudflareTunnelConfigured: Boolean(config.cloudflareTunnelToken),\n    cloudflareTunnelMode: config.cloudflareTunnelToken ? \"named\" : (quickTunnelWebSocketUrl ? \"quick\" : \"starting\"),\n    cloudflareTunnelRunning: Boolean(cloudflaredProcess && !cloudflaredProcess.killed),",
  "bridge tunnel status",
);

const oldFunction = `function startCloudflareTunnel() {
  const token = String(config.cloudflareTunnelToken || "").trim();
  if (!token) {
    console.log("[TUNNEL] Cloudflare Tunnel not configured. Local bridge remains available.");
    return;
  }
  const exe = prepareCloudflared();
  if (!exe) {
    console.log("[TUNNEL] cloudflared.exe is not bundled or available.");
    return;
  }
  try {
    cloudflaredProcess = spawn(exe, ["tunnel", "--no-autoupdate", "run", "--token", token], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    cloudflaredProcess.stdout.on("data", (chunk) => console.log(\`[TUNNEL] \${String(chunk).trim()}\`));
    cloudflaredProcess.stderr.on("data", (chunk) => console.log(\`[TUNNEL] \${String(chunk).trim()}\`));
    cloudflaredProcess.on("exit", (code) => {
      console.log(\`[TUNNEL] cloudflared exited with code \${code}.\`);
      cloudflaredProcess = null;
    });
  } catch (error) {
    console.log(\`[TUNNEL] Could not start cloudflared: \${error.message}\`);
  }
}`;

const newFunction = `function startCloudflareTunnel() {
  const token = String(config.cloudflareTunnelToken || "").trim();
  const exe = prepareCloudflared();
  if (!exe) {
    console.log("[TUNNEL] cloudflared.exe is not bundled or available.");
    return;
  }

  const captureTunnelUrl = (text) => {
    const match = String(text || "").match(/https:\\/\\/[a-z0-9-]+\\.trycloudflare\\.com/i);
    if (!match) return;
    const wssUrl = match[0].replace(/^https:/i, "wss:");
    if (quickTunnelWebSocketUrl === wssUrl) return;
    quickTunnelWebSocketUrl = wssUrl;
    console.log(\`[TUNNEL] Secure NavDash WebSocket: \${wssUrl}\`);
    broadcast(bridgeInfo());
  };

  try {
    const args = token
      ? ["tunnel", "--no-autoupdate", "run", "--token", token]
      : ["tunnel", "--no-autoupdate", "--url", \`http://127.0.0.1:\${config.wsPort}\`];

    if (!token) console.log("[TUNNEL] No named tunnel configured. Starting temporary secure Quick Tunnel...");
    quickTunnelWebSocketUrl = null;
    cloudflaredProcess = spawn(exe, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    cloudflaredProcess.stdout.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) console.log(\`[TUNNEL] \${text}\`);
      if (!token) captureTunnelUrl(text);
    });
    cloudflaredProcess.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) console.log(\`[TUNNEL] \${text}\`);
      if (!token) captureTunnelUrl(text);
    });
    cloudflaredProcess.on("exit", (code) => {
      console.log(\`[TUNNEL] cloudflared exited with code \${code}.\`);
      cloudflaredProcess = null;
      if (!token) quickTunnelWebSocketUrl = null;
    });
  } catch (error) {
    console.log(\`[TUNNEL] Could not start cloudflared: \${error.message}\`);
  }
}`;

replaceOnce(oldFunction, newFunction, "Cloudflare tunnel function");

fs.writeFileSync(file, source, "utf8");
console.log("Applied automatic Cloudflare Quick Tunnel fallback.");
