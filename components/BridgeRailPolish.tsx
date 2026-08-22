"use client";

import { useEffect } from "react";

function extractBridgeCoordinates(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const lat = normalized.match(/(?:LAT\s*)?([0-9]{1,2}°\s*[0-9.]+['’′]?\s*[NS])/i)?.[1];
  const lon = normalized.match(/(?:LON\s*)?([0-9]{1,3}°\s*[0-9.]+['’′]?\s*[EW])/i)?.[1];

  return {
    lat: lat ? `LAT ${lat.replace(/\s+/g, "")}` : null,
    lon: lon ? `LON ${lon.replace(/\s+/g, "")}` : null,
  };
}

export function BridgeRailPolish() {
  useEffect(() => {
    let retryTimer = 0;
    let statusTimer = 0;
    let cancelled = false;
    let lastGoodLat = "--";
    let lastGoodLon = "--";

    const setTextIfChanged = (el: HTMLElement | null, text: string) => {
      if (!el || el.textContent === text) return;
      el.textContent = text;
    };

    const updateDynamicText = () => {
      if (cancelled) return;

      const latEl = document.getElementById("bc2-lat");
      const lonEl = document.getElementById("bc2-lon");
      const parsed = extractBridgeCoordinates(
        `${latEl?.textContent?.trim() || ""} ${lonEl?.textContent?.trim() || ""}`,
      );

      if (parsed.lat) lastGoodLat = parsed.lat;
      if (parsed.lon) lastGoodLon = parsed.lon;
      if (lastGoodLat !== "--") setTextIfChanged(latEl, lastGoodLat);
      if (lastGoodLon !== "--") setTextIfChanged(lonEl, lastGoodLon);

      // Logical-leg selection is now the only operating mode, so suppress the
      // legacy mode/status line even if the underlying bridge scraper restores it.
      const legMode = document.getElementById("bc2-legname");
      if (legMode) {
        setTextIfChanged(legMode, "");
        legMode.style.display = "none";
      }

      const routeName = document.getElementById("bc2-route")?.textContent?.trim() || "--";
      const routeLoaded = routeName !== "--" && routeName.toLowerCase() !== "no route loaded";
      const topLive = document.querySelector<HTMLElement>("#bc-v2-topbar .live");
      const aisLive = !!topLive && !/offline|waiting|disconnected/i.test(topLive.textContent || "");

      const styleStatus = (id: string, text: string, ok: boolean) => {
        const el = document.getElementById(id);
        if (!el) return;
        setTextIfChanged(el, `${ok ? "●" : "◆"} ${text}`);
        const desired = `padding:10px 5px;text-align:center;background:#050b10;color:${ok ? "#45d6a8" : "#d4ad45"};font:800 8px system-ui;letter-spacing:.09em;white-space:nowrap`;
        if (el.style.cssText !== desired) el.style.cssText = desired;
      };

      styleStatus("bc2-status-ais", aisLive ? "AIS LIVE" : "AIS CHECK", aisLive);
      styleStatus("bc2-status-route", routeLoaded ? "ROUTE LOADED" : "NO ROUTE", routeLoaded);
    };

    const applyOnce = () => {
      if (cancelled) return;
      const rail = document.getElementById("bc-v2-instruments");
      if (!rail) {
        retryTimer = window.setTimeout(applyOnce, 100);
        return;
      }

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
          el.style.cssText = "display:block;color:#55ded3;font-size:25px;font-weight:850;line-height:1.24;letter-spacing:.025em;font-variant-numeric:tabular-nums;white-space:nowrap";
        });
      }

      rail.querySelectorAll<HTMLElement>(".bc2-big-grid strong").forEach((el) => {
        el.style.cssText = "display:block;font-size:31px;line-height:1;color:#edf4fa;font-weight:850;font-variant-numeric:tabular-nums";
      });

      const leg = rail.querySelector<HTMLElement>(".bc2-leg");
      if (leg) {
        leg.style.cssText = "padding:15px 14px;border-bottom:1px solid rgba(148,163,184,.14);background:rgba(201,162,39,.03)";
        const strong = leg.querySelector<HTMLElement>("strong");
        if (strong) strong.style.cssText = "display:block;color:#f0d568;font-size:24px;line-height:1.05;font-weight:850;font-variant-numeric:tabular-nums";
        const small = leg.querySelector<HTMLElement>("small");
        if (small) {
          setTextIfChanged(small, "");
          small.style.display = "none";
        }
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
        status.innerHTML = '<span id="bc2-status-ais"></span><span id="bc2-status-route"></span>';
        rail.appendChild(status);
      }
      status.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:1px;margin-top:auto;border-top:1px solid rgba(148,163,184,.14);background:rgba(148,163,184,.12)";
      document.getElementById("bc2-status-pos")?.remove();

      const oldFooter = rail.querySelector<HTMLElement>(".bc2-wx");
      if (oldFooter) oldFooter.style.display = "none";

      updateDynamicText();
      statusTimer = window.setInterval(updateDynamicText, 1000);
    };

    applyOnce();

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      window.clearInterval(statusTimer);
    };
  }, []);

  return null;
}
