"use client";

import { useEffect } from "react";

function padHeading(value: string) {
  const match = value.match(/([0-9.]+)/);
  if (!match) return value;
  const n = Math.round(Number(match[1]));
  return Number.isFinite(n) ? `${String(((n % 360) + 360) % 360).padStart(3, "0")}°` : value;
}

export function BridgeRailPolish() {
  useEffect(() => {
    let timer = 0;
    let lastGoodLat = "--";
    let lastGoodLon = "--";
    let lastPositionChange = Date.now();
    let lastPositionKey = "";

    const apply = () => {
      const rail = document.getElementById("bc-v2-instruments");
      if (!rail) return;

      rail.style.setProperty("min-width", "330px");

      const pos = rail.querySelector<HTMLElement>(".bc2-pos");
      if (pos) {
        pos.style.cssText = "padding:16px 14px;border-bottom:1px solid rgba(148,163,184,.14);background:linear-gradient(180deg,rgba(66,211,200,.035),transparent)";
        pos.querySelectorAll<HTMLElement>("strong").forEach((el) => {
          el.style.cssText = "display:block;color:#55ded3;font-size:25px;font-weight:850;line-height:1.24;letter-spacing:.025em;font-variant-numeric:tabular-nums";
        });
      }

      const latEl = document.getElementById("bc2-lat");
      const lonEl = document.getElementById("bc2-lon");
      const latNow = latEl?.textContent?.trim() || "--";
      const lonNow = lonEl?.textContent?.trim() || "--";
      if (/[NS]$/i.test(latNow)) lastGoodLat = latNow;
      if (/[EW]$/i.test(lonNow)) lastGoodLon = lonNow;
      if (latEl && lastGoodLat !== "--" && !/[NS]$/i.test(latNow)) latEl.textContent = lastGoodLat;
      if (lonEl && lastGoodLon !== "--" && !/[EW]$/i.test(lonNow)) lonEl.textContent = lastGoodLon;

      const cog = document.getElementById("bc2-cog");
      const hdg = document.getElementById("bc2-hdg");
      if (cog?.textContent && cog.textContent !== "--") cog.textContent = padHeading(cog.textContent);
      if (hdg?.textContent && hdg.textContent !== "--") hdg.textContent = padHeading(hdg.textContent);

      rail.querySelectorAll<HTMLElement>(".bc2-big-grid strong").forEach((el) => {
        el.style.cssText = "display:block;font-size:31px;line-height:1;color:#edf4fa;font-weight:850;font-variant-numeric:tabular-nums";
      });

      const leg = rail.querySelector<HTMLElement>(".bc2-leg");
      if (leg) {
        leg.style.cssText = "padding:14px;border-bottom:1px solid rgba(148,163,184,.14);background:rgba(201,162,39,.025)";
        const strong = leg.querySelector<HTMLElement>("strong");
        if (strong) strong.style.cssText = "display:block;color:#f0d568;font-size:23px;line-height:1.05;font-weight:850;font-variant-numeric:tabular-nums";
        const small = leg.querySelector<HTMLElement>("small");
        if (small) small.style.cssText = "display:block;margin-top:7px;color:#c2ced8;font-size:10px;font-weight:700;letter-spacing:.03em";
      }

      rail.querySelectorAll<HTMLElement>(".bc2-small-grid strong").forEach((el) => {
        el.style.cssText = "font-size:18px;color:#edf4fa;font-weight:800;font-variant-numeric:tabular-nums";
      });

      let status = document.getElementById("bc2-system-strip");
      if (!status) {
        status = document.createElement("div");
        status.id = "bc2-system-strip";
        status.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;margin-top:auto;border-top:1px solid rgba(148,163,184,.14);background:rgba(148,163,184,.12)";
        status.innerHTML = '<span id="bc2-status-ais"></span><span id="bc2-status-pos"></span><span id="bc2-status-route"></span>';
        rail.appendChild(status);
      }

      const positionKey = `${lastGoodLat}|${lastGoodLon}`;
      if (positionKey !== "--|--" && positionKey !== lastPositionKey) {
        lastPositionKey = positionKey;
        lastPositionChange = Date.now();
      }
      const ageSec = Math.max(0, Math.floor((Date.now() - lastPositionChange) / 1000));
      const positionLive = lastGoodLat !== "--" && lastGoodLon !== "--";
      const routeName = document.getElementById("bc2-route")?.textContent?.trim() || "--";
      const routeLoaded = routeName !== "--" && routeName.toLowerCase() !== "no route loaded";
      const topLive = document.querySelector<HTMLElement>("#bc-v2-topbar .live");
      const aisLive = !!topLive && !/offline|waiting|disconnected/i.test(topLive.textContent || "");

      const styleStatus = (id: string, text: string, ok: boolean) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = `${ok ? "●" : "◆"} ${text}`;
        el.style.cssText = `padding:9px 5px;text-align:center;background:#050b10;color:${ok ? "#45d6a8" : "#d4ad45"};font:800 8px system-ui;letter-spacing:.08em;white-space:nowrap`;
      };
      styleStatus("bc2-status-ais", aisLive ? "AIS LIVE" : "AIS CHECK", aisLive);
      styleStatus("bc2-status-pos", positionLive ? `POS ${ageSec}s` : "POS WAIT", positionLive);
      styleStatus("bc2-status-route", routeLoaded ? "ROUTE LOADED" : "NO ROUTE", routeLoaded);

      const oldFooter = rail.querySelector<HTMLElement>(".bc2-wx");
      if (oldFooter) oldFooter.style.display = "none";
    };

    timer = window.setInterval(apply, 500);
    apply();
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
