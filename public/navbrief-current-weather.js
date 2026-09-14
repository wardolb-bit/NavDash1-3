(() => {
  const ROUTE_KEY = "navconsole-saved-route";
  let timer = 0;
  let requestId = 0;

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeRoute(payload) {
    const raw = Array.isArray(payload?.waypoints)
      ? payload.waypoints
      : Array.isArray(payload?.route?.waypoints)
        ? payload.route.waypoints
        : [];
    const waypoints = raw
      .map((wp, index) => ({
        id: String(wp?.id || `WP${index + 1}`),
        name: String(wp?.name || wp?.id || `Waypoint ${index + 1}`),
        lat: Number(wp?.lat ?? wp?.latitude),
        lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
      }))
      .filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
    return waypoints.length >= 2 ? { routeName: String(payload?.routeName || payload?.name || "NavDash Route"), waypoints } : null;
  }

  async function currentRoute() {
    try {
      const raw = window.localStorage.getItem(ROUTE_KEY);
      if (raw) {
        const route = normalizeRoute(JSON.parse(raw));
        if (route) return route;
      }
    } catch {}

    try {
      const response = await fetch("/api/route-state", { cache: "no-store" });
      if (response.ok) return normalizeRoute(await response.json());
    } catch {}
    return null;
  }

  function navBriefInputs() {
    const page = document.querySelector(".navdash-navbrief-console");
    const departureInput = page?.querySelector('input[type="datetime-local"]');
    const speedInput = page?.querySelector('input[type="number"]');
    const departure = departureInput?.value ? new Date(departureInput.value) : null;
    const speedKt = number(speedInput?.value);
    return {
      departure: departure && Number.isFinite(departure.getTime()) ? departure : null,
      speedKt: speedKt && speedKt > 0 ? speedKt : null,
    };
  }

  async function currentWeatherPlan() {
    try {
      const response = await fetch("/api/weather-plan-state", { cache: "no-store" });
      if (response.ok) {
        const json = await response.json();
        const departure = json?.departure ? new Date(json.departure) : null;
        const speedKt = number(json?.speedKt);
        if (departure && Number.isFinite(departure.getTime()) && speedKt && speedKt > 0) {
          return { departure, speedKt, source: "Weather page planning state" };
        }
      }
    } catch {}

    const local = navBriefInputs();
    return local.departure && local.speedKt
      ? { departure: local.departure, speedKt: local.speedKt, source: "Nav Brief planning inputs" }
      : null;
  }

  function ensureCard() {
    const content = document.querySelector(".navdash-navbrief-console .print-panel .mt-3.space-y-3");
    if (!(content instanceof HTMLElement)) return null;
    let card = document.getElementById("navbrief-route-weather");
    if (!(card instanceof HTMLElement)) {
      card = document.createElement("div");
      card.id = "navbrief-route-weather";
      card.className = "print-sub print-avoid border border-white/10 p-3";
      const tideMount = document.getElementById("navbrief-tides-mount");
      if (tideMount?.parentElement === content) tideMount.insertAdjacentElement("afterend", card);
      else content.insertBefore(card, content.children[1] || null);
    }
    return card;
  }

  function message(text) {
    const card = ensureCard();
    if (!card) return;
    card.dataset.currentWeather = "1";
    card.innerHTML = `<div class="text-[12px] font-black">ROUTE WEATHER</div><div class="mt-2 text-[11px] leading-5 text-[#8294a5]">${text}</div>`;
  }

  function compass(value) {
    if (!Number.isFinite(Number(value))) return "";
    const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    const normalized = ((Number(value) % 360) + 360) % 360;
    return points[Math.round(normalized / 22.5) % 16];
  }

  function windText(point) {
    const wind = number(point?.windKt);
    const gust = number(point?.gustKt);
    const dir = compass(point?.windDirectionDeg);
    if (wind === null && gust === null) return "Wind --";
    const base = wind === null ? `${gust.toFixed(0)} kt` : `${dir ? `${dir} ` : ""}${wind.toFixed(0)} kt`;
    return gust !== null && (wind === null || gust > wind) ? `${base} gust ${gust.toFixed(0)} kt` : base;
  }

  function seaText(point) {
    const height = number(point?.waveHeightFt);
    const period = number(point?.wavePeriodSec);
    const dir = compass(point?.waveDirectionDeg);
    if (height === null || height <= 0) return period !== null && period > 0 ? `Seas -- @ ${period.toFixed(0)} s${dir ? ` ${dir}` : ""}` : "Seas --";
    return `Seas ${height.toFixed(1)} ft${period !== null && period > 0 ? ` @ ${period.toFixed(0)} s` : ""}${dir ? ` ${dir}` : ""}`;
  }

  function routeTimeZone(route) {
    const first = route?.waypoints?.[0];
    if (first && first.lat >= 18 && first.lat <= 23.5 && first.lon >= -161.5 && first.lon <= -154) return { timeZone: "Pacific/Honolulu", label: "HST" };
    if (first && first.lat >= 12 && first.lat <= 22 && first.lon >= 143 && first.lon <= 146.5) return { timeZone: "Pacific/Guam", label: "ChST" };
    return null;
  }

  function timeText(date, route) {
    const zone = routeTimeZone(route);
    if (zone) {
      return `${new Intl.DateTimeFormat("en-US", { timeZone: zone.timeZone, month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date)} ${zone.label}`;
    }
    return date.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function nearestFrame(frames, eta) {
    return frames.reduce((best, frame) => {
      const bestDelta = Math.abs(new Date(best.validAt).getTime() - eta.getTime());
      const nextDelta = Math.abs(new Date(frame.validAt).getTime() - eta.getTime());
      return nextDelta < bestDelta ? frame : best;
    }, frames[0]);
  }

  function voyageSamples(weather, plan) {
    const frames = Array.isArray(weather?.frames) ? weather.frames.filter((frame) => Array.isArray(frame?.points) && frame.points.length) : [];
    if (!frames.length) return [];
    const reference = frames[0].points;
    return reference.map((referencePoint, index) => {
      const distanceNm = number(referencePoint?.distanceNm) ?? 0;
      const eta = new Date(plan.departure.getTime() + (distanceNm / plan.speedKt) * 3600000);
      const frame = nearestFrame(frames, eta);
      const point = frame?.points?.[index] || frame?.points?.reduce((best, candidate) => {
        const candidateDelta = Math.abs((number(candidate?.distanceNm) ?? 0) - distanceNm);
        const bestDelta = Math.abs((number(best?.distanceNm) ?? 0) - distanceNm);
        return candidateDelta < bestDelta ? candidate : best;
      }, frame.points[0]);
      return point ? { point, eta, distanceNm, validAt: frame.validAt } : null;
    }).filter(Boolean);
  }

  function render(weather, route, plan) {
    const samples = voyageSamples(weather, plan);
    if (!samples.length) {
      message("Current WardLab weather feed returned no route samples.");
      return;
    }

    const departure = samples[0];
    const arrival = samples[samples.length - 1];
    const maxWind = samples.reduce((best, sample) => {
      const sampleWind = Math.max(number(sample.point?.windKt) ?? 0, number(sample.point?.gustKt) ?? 0);
      const bestWind = Math.max(number(best.point?.windKt) ?? 0, number(best.point?.gustKt) ?? 0);
      return sampleWind > bestWind ? sample : best;
    }, samples[0]);
    const maxSeas = samples.reduce((best, sample) => (number(sample.point?.waveHeightFt) ?? 0) > (number(best.point?.waveHeightFt) ?? 0) ? sample : best, samples[0]);
    const longestPeriod = samples.reduce((best, sample) => (number(sample.point?.wavePeriodSec) ?? 0) > (number(best.point?.wavePeriodSec) ?? 0) ? sample : best, samples[0]);

    const card = ensureCard();
    if (!card) return;
    card.dataset.currentWeather = "1";
    const source = weather.waveOverlay ? "WX.WARDLAB.DEV · GFS ATMOS + GFS WAVE GRIB" : "WX.WARDLAB.DEV · NOAA/NWS";
    const lines = [
      `Departure · ${windText(departure.point)} · ${seaText(departure.point)}`,
      `Arrival · ${windText(arrival.point)} · ${seaText(arrival.point)}`,
      `Max wind · ${windText(maxWind.point)} · ${maxWind.distanceNm.toFixed(0)} NM along route · ${timeText(maxWind.eta, route)}`,
      `Max seas · ${seaText(maxSeas.point)} · ${maxSeas.distanceNm.toFixed(0)} NM along route · ${timeText(maxSeas.eta, route)}`,
      number(longestPeriod.point?.wavePeriodSec) !== null && number(longestPeriod.point?.wavePeriodSec) > 0
        ? `Longest wave period · ${seaText(longestPeriod.point)} · ${longestPeriod.distanceNm.toFixed(0)} NM along route · ${timeText(longestPeriod.eta, route)}`
        : null,
    ].filter(Boolean);

    card.innerHTML = `
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <div class="text-[12px] font-black">ROUTE WEATHER</div>
        <div class="font-mono text-[9px] text-[#42d3c8]">${source}</div>
      </div>
      <div class="mt-1 text-[9px] uppercase tracking-[.08em] text-[#8294a5]">${plan.source} · ${plan.speedKt.toFixed(1)} KT · DEP ${timeText(plan.departure, route)}</div>
      <div class="mt-2 grid grid-cols-1 gap-x-5 gap-y-1 text-[11px] leading-5 text-[#8294a5] md:grid-cols-2">
        ${lines.map((line) => `<div>${line}</div>`).join("")}
      </div>`;
  }

  async function refresh() {
    const id = ++requestId;
    const route = await currentRoute();
    if (id !== requestId) return;
    if (!route) {
      message("Load the current NavDash route before building the weather section.");
      return;
    }

    const plan = await currentWeatherPlan();
    if (id !== requestId) return;
    if (!plan) {
      message("Set departure time and planning speed on the current Weather page or in Nav Brief.");
      return;
    }

    try {
      const response = await fetch("/api/nav-brief-route-weather", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ waypoints: route.waypoints }),
      });
      const weather = await response.json();
      if (id !== requestId) return;
      if (!response.ok || !weather?.ok) throw new Error(weather?.error || `Weather feed returned ${response.status}`);
      render(weather, route, plan);
    } catch (error) {
      message(error instanceof Error ? error.message : "Current WardLab route weather unavailable.");
    }
  }

  function schedule(delay = 420) {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { void refresh(); }, delay);
  }

  document.addEventListener("DOMContentLoaded", () => schedule(900), { once: true });
  document.addEventListener("input", () => schedule(), true);
  document.addEventListener("change", () => schedule(), true);
  document.addEventListener("click", () => schedule(520), true);
  window.addEventListener("pageshow", () => schedule(700));
  window.setTimeout(() => schedule(0), 1800);
})();
