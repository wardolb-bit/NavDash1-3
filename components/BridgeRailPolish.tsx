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

    const apply = () => {
      const rail = document.getElementById("bc-v2-instruments");
      if (!rail) return;

      rail.style.setProperty("min-width", "330px");

      const title = rail.querySelector<HTMLElement>(".bc2-rail-title");
      if (title) {
        title.style.cssText = "padding:13px 14px;border-bottom:1px solid rgba(148,163,184,.14);background:linear-gradient(90deg,rgba(201,162,39,.045),transparent)";
        const route = document.getElementById("bc2-route");
        if (route) route.style.cssText = "display:block;font-size:18px;color:#e7c95c;line-height:1.1;font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
        const dest = document.getElementById("bc2-dest");
        if (dest) dest.style.cssText = "display:block;margin-top:6px;color:#aebdca;font-size:11px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      }

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
        leg.style.cssText = "padding:15px 14px;border-bottom:1px solid rgba(148,163,184,.14);background:rgba(201,162,39,.03)";
        const strong = leg.querySelector<HTMLElement>("strong");
        if (strong) strong.style.cssText = "display:block;color:#f0d568;font-size:24px;line-height:1.05;font-weight:850;font-variant-numeric:tabular-nums";
        const small = leg.querySelector<HTMLElement>("small");
        if (small) small.style.cssText = "display:block;margin-top:8px;color:#c2ced8;font-size:11px;font-weight:700;letter-spacing:.03em";
      }

      const smallGrid = rail.querySelector<HTMLElement>(".bc2-small-grid");
      if (smallGrid) smallGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid rgba(148,163,184,.14);background:#060d13";
      rail.querySelectorAll<HTMLElement>(".bc2-small-grid > div").forEach((cell, i) => {
        cell.style.cssText = `padding:12px 14px;min-height:62px;${i % 2 === 0 ? "border-right:1px solid rgba(148,163,184,.14);" : ""}${i < 2 ? "border-bottom:1px solid rgba(148,163,184,.14);" : ""}`;
      });
      rail.querySelectorAll<HTMLElement>(".bc2-small-grid strong").forEach((el) => {
        el.style.cssText = "font-size:19px;color:#edf4fa;font-weight:800;font-variant-numeric:tabular-nums";
      });

      let status = document.getElementById("bc2-system-strip");
      if (!status) {
        status = document.createElement("div");
        status.id = "bc2-system-strip";
        status.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:1px;margin-top:auto;border-top:1px solid rgba(148,163,184,.14);background:rgba(148,163,184,.12)";
        status.innerHTML = '<span id="bc2-status-ais"></span><span id="bc2-status-route"></span>';
        rail.appendChild(status);
      } else {
        status.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:1px;margin-top:auto;border-top:1px solid rgba(148,163,184,.14);background:rgba(148,163,184,.12)";
        document.getElementById("bc2-status-pos")?.remove();
      }

      const routeName = document.getElementById("bc2-route")?.textContent?.trim() || "--";
      const routeLoaded = routeName !== "--" && routeName.toLowerCase() !== "no route loaded";
      const topLive = document.querySelector<HTMLElement>("#bc-v2-topbar .live");
      const aisLive = !!topLive && !/offline|waiting|disconnected/i.test(topLive.textContent || "");

      const styleStatus = (id: string, text: string, ok: boolean) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = `${ok ? "●" : "◆"} ${text}`;
        el.style.cssText = `padding:10px 5px;text-align:center;background:#050b10;color:${ok ? "#45d6a8" : "#d4ad45"};font:800 8px system-ui;letter-spacing:.09em;white-space:nowrap`;
      };
      styleStatus("bc2-status-ais", aisLive ? "AIS LIVE" : "AIS CHECK", aisLive);
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
