"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

function important(el: HTMLElement | null, prop: string, value: string) {
  if (!el) return;
  el.style.setProperty(prop, value, "important");
}

type RouteWaypoint = { lat: number; lon: number };
type RouteStatePayload = { waypoints: RouteWaypoint[] };

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function unwrapLongitudeNear(value: number, reference: number) {
  let next = value;
  while (next - reference > 180) next -= 360;
  while (next - reference < -180) next += 360;
  return next;
}

function distanceNm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const radiusNm = 3440.065;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(unwrapLongitudeNear(bLon, aLon) - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusNm * Math.asin(Math.sqrt(h));
}

function parseDdmCoordinate(text: string, isLat: boolean) {
  const hemiPattern = isLat ? "[NS]" : "[EW]";
  const match = text.match(new RegExp(`(\\d{1,3})\\s+(\\d+(?:\\.\\d+)?)['’′]?\\s*(${hemiPattern})`, "i"));
  if (!match) return null;
  const degrees = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes)) return null;
  const sign = /[SW]/i.test(match[3]) ? -1 : 1;
  return sign * (degrees + minutes / 60);
}

function findDisplayedOwnShip(root: HTMLElement) {
  const labels = Array.from(root.querySelectorAll<HTMLElement>("div"));
  const label = labels.find((el) => (el.textContent || "").trim() === "Position");
  const value = label?.nextElementSibling as HTMLElement | null;
  const parts = (value?.textContent || "").split("/");
  if (parts.length < 2) return null;
  const lat = parseDdmCoordinate(parts[0], true);
  const lon = parseDdmCoordinate(parts[1], false);
  return lat === null || lon === null ? null : { lat, lon };
}

function findPlanningSpeed(root: HTMLElement) {
  const labels = Array.from(root.querySelectorAll<HTMLElement>("label"));
  const planning = labels.find((el) => /Planning Speed/i.test(el.textContent || ""));
  const input = planning?.querySelector<HTMLInputElement>("input");
  const speed = Number(input?.value);
  return Number.isFinite(speed) && speed > 0 ? speed : null;
}

function logicalActiveWaypointIndex(route: RouteWaypoint[], position: { lat: number; lon: number }) {
  if (route.length < 2) return 1;

  let bestLeg = 0;
  let bestOffTrack = Number.POSITIVE_INFINITY;

  for (let i = 0; i < route.length - 1; i += 1) {
    const start = route[i];
    const end = route[i + 1];
    const refLat = (position.lat + start.lat + end.lat) / 3;
    const nmPerDegLon = Math.max(0.01, 60 * Math.cos(toRad(refLat)));

    const startLon = unwrapLongitudeNear(start.lon, position.lon);
    const endLon = unwrapLongitudeNear(end.lon, startLon);
    const posLon = unwrapLongitudeNear(position.lon, startLon);

    const startX = startLon * nmPerDegLon;
    const startY = start.lat * 60;
    const endX = endLon * nmPerDegLon;
    const endY = end.lat * 60;
    const posX = posLon * nmPerDegLon;
    const posY = position.lat * 60;

    const dx = endX - startX;
    const dy = endY - startY;
    const denom = dx * dx + dy * dy;
    const t = denom > 0 ? Math.max(0, Math.min(1, ((posX - startX) * dx + (posY - startY) * dy) / denom)) : 0;
    const closestX = startX + dx * t;
    const closestY = startY + dy * t;
    const offTrack = Math.hypot(posX - closestX, posY - closestY);

    if (offTrack < bestOffTrack) {
      bestOffTrack = offTrack;
      bestLeg = i;
    }
  }

  return Math.min(route.length - 1, bestLeg + 1);
}

function waypointUtcOffsetHours(lon: number) {
  if (!Number.isFinite(lon)) return 0;
  let normalized = lon;
  while (normalized > 180) normalized -= 360;
  while (normalized < -180) normalized += 360;
  return Math.max(-12, Math.min(12, Math.round(normalized / 15)));
}

function signed(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}

function localEtaParts(hoursFromNow: number, waypointLon: number) {
  const etaUtcMs = Date.now() + Math.max(0, hoursFromNow) * 3600000;
  const utcOffset = waypointUtcOffsetHours(waypointLon);
  const zoneDescription = -utcOffset;
  const local = new Date(etaUtcMs + utcOffset * 3600000);
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  const hour = String(local.getUTCHours()).padStart(2, "0");
  const minute = String(local.getUTCMinutes()).padStart(2, "0");
  const utcLabel = utcOffset === 0 ? "UTC" : `UTC${signed(utcOffset)}`;
  return {
    dateTime: `${month}/${day} ${hour}${minute}`,
    zone: `LT · ZD ${signed(zoneDescription)} · ${utcLabel}`,
  };
}

function findEtaValue(card: HTMLElement) {
  const nodes = Array.from(card.querySelectorAll<HTMLElement>("div"));
  const label = nodes.find((el) => (el.textContent || "").trim() === "ETA WPT");
  return label?.nextElementSibling as HTMLElement | null;
}

function hideTechnicalWxDetails(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("div,span,p").forEach((el) => {
    const text = (el.textContent || "").trim();
    if (!text) return;

    if (/^Isobar Samples$/i.test(text)) {
      important(el.parentElement, "display", "none");
      return;
    }

    if (/^(\d+\s+)?(wind|map|grib|isobar)?\s*samples?$/i.test(text)) {
      important(el, "display", "none");
      return;
    }

    if (/\.exe\b/i.test(text) || /executable/i.test(text) || /sample(?:d)?\s+points?/i.test(text)) {
      const sourceDetail = !!el.parentElement?.querySelector("div") && /Data Source/i.test(el.parentElement?.textContent || "");
      if (sourceDetail || /\.exe\b/i.test(text)) important(el, "display", "none");
    }
  });
}

export function WxRoutingBridgeSkin() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/wx-routing") return;

    let cancelled = false;
    let retryTimer = 0;
    let routeRefreshTimer = 0;
    let observer: MutationObserver | null = null;
    let correctionQueued = false;
    let routeState: RouteStatePayload | null = null;

    const loadRouteState = async () => {
      try {
        const response = await fetch("/api/route-state", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        const waypoints = (Array.isArray(payload?.waypoints) ? payload.waypoints : [])
          .map((wp: any) => ({
            lat: Number(wp?.lat ?? wp?.latitude),
            lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
          }))
          .filter((wp: RouteWaypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
        if (waypoints.length >= 2) routeState = { waypoints };
      } catch {}
    };

    const correctLegEtas = (root: HTMLElement) => {
      if (!routeState) return;
      const ownShip = findDisplayedOwnShip(root);
      const speed = findPlanningSpeed(root);
      if (!ownShip || !speed) return;

      const waypoints = routeState.waypoints;
      const activeWaypointIndex = logicalActiveWaypointIndex(waypoints, ownShip);
      const cards = Array.from(root.querySelectorAll<HTMLElement>("button")).filter((card) =>
        Array.from(card.querySelectorAll<HTMLElement>("div")).some((el) => (el.textContent || "").trim() === "ETA WPT"),
      );
      if (!cards.length) return;

      let hoursToWaypoint = distanceNm(
        ownShip.lat,
        ownShip.lon,
        waypoints[activeWaypointIndex].lat,
        waypoints[activeWaypointIndex].lon,
      ) / speed;

      cards.forEach((card, legIndex) => {
        const etaValue = findEtaValue(card);
        const destinationWaypointIndex = legIndex + 1;
        if (!etaValue || destinationWaypointIndex >= waypoints.length) return;

        if (destinationWaypointIndex < activeWaypointIndex) {
          if (etaValue.textContent !== "Passed") etaValue.textContent = "Passed";
          etaValue.removeAttribute("data-wxr-eta-signature");
          return;
        }

        if (destinationWaypointIndex > activeWaypointIndex) {
          hoursToWaypoint += distanceNm(
            waypoints[destinationWaypointIndex - 1].lat,
            waypoints[destinationWaypointIndex - 1].lon,
            waypoints[destinationWaypointIndex].lat,
            waypoints[destinationWaypointIndex].lon,
          ) / speed;
        }

        const eta = localEtaParts(hoursToWaypoint, waypoints[destinationWaypointIndex].lon);
        const signature = `${eta.dateTime}|${eta.zone}`;
        const zoneExists = !!etaValue.querySelector("[data-wxr-eta-zone]");
        if (etaValue.dataset.wxrEtaSignature === signature && zoneExists) return;

        etaValue.replaceChildren(document.createTextNode(eta.dateTime));
        const zone = document.createElement("span");
        zone.dataset.wxrEtaZone = "true";
        zone.textContent = eta.zone;
        zone.style.cssText = "display:block;margin-top:2px;font-size:.68rem;font-weight:800;opacity:.78;white-space:nowrap";
        etaValue.appendChild(zone);
        etaValue.dataset.wxrEtaSignature = signature;
      });
    };

    const queueCorrection = (root: HTMLElement) => {
      if (correctionQueued || cancelled) return;
      correctionQueued = true;
      window.requestAnimationFrame(() => {
        correctionQueued = false;
        if (cancelled) return;
        hideTechnicalWxDetails(root);
        correctLegEtas(root);
      });
    };

    const apply = () => {
      if (cancelled) return;
      const main = document.querySelector<HTMLElement>("main");
      const shell = main?.firstElementChild as HTMLElement | null;
      const header = shell?.querySelector<HTMLElement>(":scope > header") || null;
      if (!main || !shell || !header) {
        retryTimer = window.setTimeout(apply, 100);
        return;
      }

      const globalNav = document.querySelector<HTMLElement>("body > nav");
      if (globalNav) important(globalNav, "display", "none");

      important(main, "background", "#04080c");
      important(main, "color", "#dbe5ee");
      important(shell, "padding", "6px");
      important(shell, "gap", "5px");

      let topbar = document.getElementById("wxr-v2-topbar");
      if (!topbar) {
        topbar = document.createElement("div");
        topbar.id = "wxr-v2-topbar";
        topbar.innerHTML = `
          <div class="wxr-brand"><span class="wxr-logo">N</span><span><b>NAVDASH</b><small>M/V MB480 · WEATHER ROUTING</small></span></div>
          <div class="wxr-center"><span class="wxr-live"><i></i>WX ROUTING</span><span>GRIB / ROUTE EXPOSURE</span></div>
          <div class="wxr-actions"><a href="/">NAV CONSOLE</a></div>
        `;
        shell.insertBefore(topbar, header);
      }

      topbar.style.cssText = "height:46px;display:grid;grid-template-columns:280px 1fr 180px;align-items:center;padding:0 12px;border:1px solid rgba(201,162,39,.30);background:#071019;color:#e7edf3;font:700 11px system-ui;letter-spacing:.08em";
      const brand = topbar.querySelector<HTMLElement>(".wxr-brand");
      if (brand) brand.style.cssText = "display:flex;align-items:center;gap:9px";
      const logo = topbar.querySelector<HTMLElement>(".wxr-logo");
      if (logo) logo.style.cssText = "display:grid;place-items:center;width:28px;height:28px;border:1px solid #c9a227;color:#e7c95c;font-size:15px;font-weight:900";
      const stack = topbar.querySelector<HTMLElement>(".wxr-brand span:last-child");
      if (stack) stack.style.cssText = "display:flex;flex-direction:column;line-height:1";
      const small = topbar.querySelector<HTMLElement>("small");
      if (small) small.style.cssText = "margin-top:4px;font-size:8px;color:#8294a5;letter-spacing:.14em";
      const center = topbar.querySelector<HTMLElement>(".wxr-center");
      if (center) center.style.cssText = "display:flex;justify-content:center;gap:8px";
      topbar.querySelectorAll<HTMLElement>(".wxr-center span").forEach((el) => {
        el.style.cssText = "padding:5px 9px;border:1px solid rgba(148,163,184,.18);background:#050a0f;color:#aebdca;font-size:9px";
      });
      const dot = topbar.querySelector<HTMLElement>(".wxr-live i");
      if (dot) dot.style.cssText = "display:inline-block;width:6px;height:6px;border-radius:50%;background:#22d3ee;margin-right:6px;box-shadow:0 0 8px rgba(34,211,238,.55)";
      const action = topbar.querySelector<HTMLAnchorElement>(".wxr-actions a");
      if (action) action.style.cssText = "display:inline-flex;height:30px;min-width:110px;align-items:center;justify-content:center;border:1px solid rgba(201,162,39,.55);background:#071019;color:#e7c95c;text-decoration:none;font:900 9px system-ui;letter-spacing:.10em";
      const actions = topbar.querySelector<HTMLElement>(".wxr-actions");
      if (actions) actions.style.cssText = "display:flex;justify-content:flex-end";

      important(header, "padding", "6px 8px");
      important(header, "margin", "0");
      important(header, "border-radius", "0");
      important(header, "border", "1px solid rgba(148,163,184,.14)");
      important(header, "background", "#071019");
      important(header, "box-shadow", "none");

      const heading = header.querySelector<HTMLElement>("h1");
      if (heading) {
        heading.textContent = "WX ROUTING";
        heading.style.cssText = "margin:0;color:#edf4fa;font-size:20px;font-weight:900;letter-spacing:.08em";
      }
      const kicker = header.querySelector<HTMLElement>("div > div");
      if (kicker) kicker.style.cssText = "color:#c9a227;font-size:8px;font-weight:900;letter-spacing:.16em;text-transform:uppercase";
      const intro = header.querySelector<HTMLElement>("p");
      if (intro) intro.style.cssText = "margin-top:3px;color:#8294a5;font-size:10px;line-height:1.35";

      header.querySelectorAll<HTMLElement>("button,label").forEach((el) => {
        important(el, "border-radius", "3px");
        important(el, "height", "30px");
        important(el, "padding", "0 9px");
        important(el, "font-size", "9px");
        important(el, "font-weight", "900");
        important(el, "letter-spacing", ".06em");
        important(el, "box-shadow", "none");
      });

      shell.querySelectorAll<HTMLElement>("section,aside").forEach((el) => {
        if (el.closest("header")) return;
        important(el, "border-radius", "0");
        important(el, "box-shadow", "none");
      });
      shell.querySelectorAll<HTMLElement>("button").forEach((el) => {
        important(el, "border-radius", "3px");
        important(el, "box-shadow", "none");
      });

      hideTechnicalWxDetails(shell);
      loadRouteState().then(() => queueCorrection(shell));

      observer = new MutationObserver(() => queueCorrection(shell));
      observer.observe(shell, { childList: true, subtree: true, characterData: true });

      routeRefreshTimer = window.setInterval(() => {
        loadRouteState().then(() => queueCorrection(shell));
      }, 10000);
    };

    apply();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      window.clearInterval(routeRefreshTimer);
      observer?.disconnect();
      document.getElementById("wxr-v2-topbar")?.remove();
    };
  }, [pathname]);

  return null;
}
