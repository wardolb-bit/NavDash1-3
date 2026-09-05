"use client";

import { useEffect } from "react";

function important(el: HTMLElement | null, property: string, value: string) {
  el?.style.setProperty(property, value, "important");
}
function valueFor(root: HTMLElement, label: string) {
  const labelEl = Array.from(root.querySelectorAll<HTMLElement>("div")).find((el) => el.textContent?.trim() === label);
  const box = labelEl?.parentElement as HTMLElement | null;
  return box ? Array.from(box.children).map((el) => (el as HTMLElement).textContent?.trim() || "").filter((text) => text && text !== label).join(" ") || "--" : "--";
}

const themeCss = `
body::before{display:none!important}
.navdash-v12-night,.navdash-v12-day{--bg:#06111f;--deep:#040d18;--panel:#0a1c2e;--alt:#10263a;--text:#eaf4fb;--muted:#7f9caf;--border:#1d3a52;--gold:#f2b84b;--gold2:#f0c46a;--cyan:#56bad0;--shadow:rgba(1,7,17,.48);max-width:1520px;margin:0 auto;padding:0 28px 22px!important;background:transparent!important;color:var(--text)!important;font-family:"Avenir Next","Segoe UI",system-ui,sans-serif}
.navdash-v12-day{--bg:#edf3f7;--deep:#dce7ee;--panel:#fff;--alt:#e7eef3;--text:#122434;--muted:#52697a;--border:#b9cbd7;--gold:#8a5a00;--gold2:#a16b06;--cyan:#087c8c;--shadow:rgba(20,51,72,.14)}
#bc-v2-topbar{min-height:94px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border)}
.bc2-brand{display:flex;align-items:center;gap:14px}.bc2-logo{width:46px;height:46px;display:grid;place-items:center;border:1px solid #496782;border-radius:50%;color:var(--gold);box-shadow:inset 0 0 18px #1b4566}.bc2-logo svg{width:25px}.bc2-brand-copy b{display:block;font-size:1.35rem;line-height:1;letter-spacing:.2em;font-weight:650}.bc2-brand-copy i{color:var(--gold);font-family:Georgia,serif;font-weight:400}.bc2-brand-copy small{display:block;margin-top:7px;color:var(--muted);font-size:.68rem;letter-spacing:.18em;font-weight:650}
.bc2-clock{display:flex;align-items:center;gap:11px;color:#88a8bd;text-align:right}.bc2-clock svg{width:20px}.bc2-clock strong{display:block;color:var(--gold2);font:600 1.35rem/1 "SFMono-Regular",Consolas,monospace;letter-spacing:.04em}.bc2-clock span{display:block;margin-top:5px;color:var(--muted);font:.68rem/1 "SFMono-Regular",Consolas,monospace;letter-spacing:.06em}
#bc2-position-bar{min-height:78px;display:flex;align-items:center;gap:22px;border-bottom:1px solid var(--border)}.bc2-position-main{display:flex;align-items:center;gap:12px;flex:1;min-width:0}.bc2-position-main svg{width:20px;color:var(--cyan)}.bc2-position-main span{display:block;margin-bottom:4px;color:var(--muted);font-size:.66rem;letter-spacing:.14em;font-weight:700}.bc2-position-main strong{display:block;font:600 1rem/1.2 "SFMono-Regular",Consolas,monospace;letter-spacing:.02em}.bc2-position-main strong i{font-style:normal}.bc2-position-main b{color:#4b687c;padding:0 8px}.bc2-position-meta{color:var(--muted);font:.7rem "SFMono-Regular",Consolas,monospace;letter-spacing:.05em}
#bc2-watch-strip{display:grid;grid-template-columns:repeat(4,1fr);margin:22px 0;overflow:hidden;border:1px solid var(--border);border-radius:12px;background:var(--panel);box-shadow:0 18px 60px var(--shadow)}#bc2-watch-strip>div{min-width:0;padding:15px 20px;display:grid;grid-template-columns:1fr auto;align-items:end;gap:3px 12px;border-right:1px solid var(--border)}#bc2-watch-strip>div:last-child{border:0}#bc2-watch-strip span{grid-column:1/-1;color:var(--muted);font-size:.65rem;letter-spacing:.13em;font-weight:700}#bc2-watch-strip strong{overflow:hidden;color:var(--gold2);font:600 1.24rem "SFMono-Regular",Consolas,monospace;text-overflow:ellipsis;white-space:nowrap}#bc2-watch-strip small{color:#88a5b8;font:.65rem "SFMono-Regular",Consolas,monospace;white-space:nowrap}
.bc2-actionbar{margin-bottom:18px!important;padding:8px!important;border:1px solid var(--border)!important;border-radius:12px!important;background:var(--panel)!important;box-shadow:0 18px 55px var(--shadow)!important;backdrop-filter:none!important}.bc2-actionbar>div{display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:7px!important}.bc2-actionbar button,.bc2-actionbar label,.bc2-actionbar a{width:auto!important;min-width:94px!important;height:38px!important;padding:0 12px!important;border:1px solid #31506a!important;border-radius:7px!important;background:#0a1a2a!important;color:var(--text)!important;box-shadow:none!important;font-size:11px!important;font-weight:700!important}.navdash-v12-day .bc2-actionbar button,.navdash-v12-day .bc2-actionbar label,.navdash-v12-day .bc2-actionbar a{background:#fff!important;border-color:var(--border)!important}
.bc2-dashboard{display:grid!important;grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr)!important;gap:18px!important;align-items:stretch!important}
#v12-section-chart,#bc-v2-instruments{overflow:hidden;border:1px solid var(--border)!important;border-radius:14px!important;background:linear-gradient(145deg,var(--panel),color-mix(in srgb,var(--panel) 92%,var(--deep)))!important;box-shadow:0 18px 55px var(--shadow)!important}#v12-section-chart{position:relative!important;padding:70px 18px 18px!important;margin:0!important}#v12-section-chart::before{display:none!important}#v12-section-chart>#v12-map+div{display:none!important}
.bc2-panel-heading{position:absolute;inset:0 0 auto;min-height:70px;padding:15px 19px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);z-index:1200;pointer-events:none}.bc2-panel-heading span,.bc2-rail-heading span{color:var(--muted);font-size:.68rem;letter-spacing:.18em;font-weight:650}.bc2-panel-heading h2,.bc2-rail-heading h2{margin:4px 0 0;color:var(--text);font-size:1.03rem;font-weight:600}.bc2-panel-heading svg,.bc2-rail-heading svg{width:21px;color:var(--cyan)}
#v12-map{display:block!important;width:100%!important;height:max(520px,calc(100vh - 430px))!important;min-height:520px!important;border:1px solid var(--border)!important;border-radius:10px!important;background:var(--alt)!important;overflow:hidden!important}
#bc-chart-tools{position:absolute;top:82px;left:30px;z-index:1300;display:flex;gap:5px;padding:5px;border:1px solid var(--border);border-radius:8px;background:var(--deep);opacity:.94}#bc-chart-tools button{height:30px;padding:0 10px;border:1px solid #31506a;border-radius:6px;background:#0a1a2a;color:var(--text);font:800 9px system-ui;letter-spacing:.08em;cursor:pointer}.navdash-v12-day #bc-chart-tools,.navdash-v12-day #bc-chart-tools button{background:#fff}
#bc-v2-instruments{min-height:100%;color:var(--text)}.bc2-rail-heading{min-height:70px;padding:15px 19px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border)}#bc-v2-instruments label{display:block;color:var(--muted);font-size:.65rem;font-weight:700;letter-spacing:.14em}.bc2-voyage{padding:16px 19px 11px;border-bottom:1px solid var(--border)}.bc2-voyage b{display:block;margin-top:7px;color:var(--gold2);font-size:.95rem}.bc2-voyage small{display:block;margin-top:4px;color:var(--muted);font:.69rem "SFMono-Regular",Consolas,monospace}.bc2-big-grid,.bc2-small-grid{display:grid;grid-template-columns:1fr 1fr}.bc2-big-grid>div,.bc2-small-grid>div{min-height:82px;padding:15px 19px;border-bottom:1px solid var(--border)}.bc2-big-grid>div:nth-child(odd),.bc2-small-grid>div:nth-child(odd){border-right:1px solid var(--border)}.bc2-big-grid strong,.bc2-small-grid strong{display:block;margin-top:10px;color:var(--text);font:600 1.3rem "SFMono-Regular",Consolas,monospace}.bc2-small-grid strong{font-size:.92rem}.bc2-leg{padding:15px 19px;border-bottom:1px solid var(--border)}.bc2-leg strong{display:block;margin-top:9px;color:var(--gold2);font:600 1.15rem "SFMono-Regular",Consolas,monospace}.bc2-leg small{display:block;margin-top:5px;color:var(--muted);font-size:.69rem}
@media(max-width:900px){.navdash-v12-night,.navdash-v12-day{padding:0 16px 18px!important}#bc2-watch-strip{grid-template-columns:1fr 1fr;margin:16px 0}#bc2-watch-strip>div:nth-child(2){border-right:0}#bc2-watch-strip>div:nth-child(-n+2){border-bottom:1px solid var(--border)}.bc2-dashboard{grid-template-columns:1fr!important}#v12-map{height:58vh!important;min-height:420px!important}}
@media(max-width:640px){#bc-v2-topbar{min-height:78px}.bc2-logo{width:39px;height:39px}.bc2-brand-copy b{font-size:1.05rem}.bc2-brand-copy small{font-size:.55rem}.bc2-clock svg{display:none}.bc2-clock strong{font-size:1rem}#bc2-position-bar{min-height:68px}.bc2-position-main strong{font-size:.78rem}.bc2-position-meta{display:none}#bc2-watch-strip strong{font-size:1rem}.bc2-actionbar>div{overflow-x:auto;justify-content:flex-start!important}}
`;

export function BridgeConsolePreview() {
  useEffect(() => {
    let attempts = 0, retryTimer = 0, syncTimer = 0, mapResizeTimer = 0;
    let mapObserver: ResizeObserver | null = null, overlayObserver: MutationObserver | null = null;
    let vectorVisible = true, aisVisible = true;
    const style = document.createElement("style");
    style.id = "tide-sky-bridge-theme";
    style.textContent = themeCss;
    document.head.appendChild(style);
    const recoverMap = () => { window.clearTimeout(mapResizeTimer); mapResizeTimer = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 180); };

    const apply = () => {
      attempts++;
      const shell = document.querySelector<HTMLElement>(".navdash-v12-day, .navdash-v12-night");
      const chart = document.getElementById("v12-section-chart") as HTMLElement | null;
      const map = document.getElementById("v12-map") as HTMLElement | null;
      const route = document.getElementById("v12-section-route") as HTMLElement | null;
      if (!shell || !chart || !map || !route) { if (attempts < 80) retryTimer = window.setTimeout(apply, 100); return; }
      important(document.querySelector<HTMLElement>("body > nav"), "display", "none");
      const children = Array.from(shell.children) as HTMLElement[];
      const header = children.find((el) => el.tagName === "HEADER") || null;
      const navStrip = header?.nextElementSibling as HTMLElement | null;
      const mainGrid = navStrip?.nextElementSibling as HTMLElement | null;
      const oldRail = route.parentElement as HTMLElement | null;
      const activeLeg = route.nextElementSibling as HTMLElement | null;

      let topbar = document.getElementById("bc-v2-topbar");
      if (!topbar) {
        topbar = document.createElement("div"); topbar.id = "bc-v2-topbar";
        topbar.innerHTML = `<div class="bc2-brand"><span class="bc2-logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 15c2.2 0 2.2-1.6 4.4-1.6S9.6 15 11.8 15s2.2-1.6 4.4-1.6S18.4 15 20.6 15"/><path d="M5 10.5c1.7 0 1.7-1.3 3.4-1.3s1.7 1.3 3.4 1.3 1.7-1.3 3.4-1.3 1.7 1.3 3.4 1.3"/></svg></span><span class="bc2-brand-copy"><b>NAV <i>&</i> DASH</b><small>MARINER'S BRIDGE CONSOLE</small></span></div><div class="bc2-clock"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><div><strong id="bc2-utc">--:--:--Z</strong><span id="bc2-date">UTC</span></div></div>`;
        shell.insertBefore(topbar, shell.firstChild);
      }
      let positionBar = document.getElementById("bc2-position-bar");
      if (!positionBar) {
        positionBar = document.createElement("section"); positionBar.id = "bc2-position-bar";
        positionBar.innerHTML = `<div class="bc2-position-main"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m4 4 16 7-7 2-2 7z"/></svg><div><span>VESSEL POSITION</span><strong><i id="bc2-lat">--</i><b>/</b><i id="bc2-lon">--</i></strong></div></div><div class="bc2-position-meta">AIS · LIVE NAVIGATION FEED</div>`; topbar.after(positionBar);
      }
      let watch = document.getElementById("bc2-watch-strip");
      if (!watch) {
        watch = document.createElement("section"); watch.id = "bc2-watch-strip";
        watch.innerHTML = `<div><span>COURSE OVER GROUND</span><strong id="bc2-cog">--</strong><small>TRUE</small></div><div><span>SPEED OVER GROUND</span><strong id="bc2-sog">--</strong><small>KNOTS</small></div><div><span>ACTIVE LEG</span><strong id="bc2-watch-leg">--</strong><small id="bc2-watch-brg">BRG --</small></div><div><span>DISTANCE TO GO</span><strong id="bc2-watch-dtg">--</strong><small id="bc2-watch-eta">ETA --</small></div>`; positionBar.after(watch);
      }
      if (header) { header.classList.add("bc2-actionbar"); important(header.firstElementChild?.firstElementChild as HTMLElement | null, "display", "none"); }
      important(navStrip, "display", "none"); mainGrid?.classList.add("bc2-dashboard"); important(mainGrid, "display", "grid");
      important(route, "display", "none"); important(activeLeg, "display", "none"); important(oldRail, "display", "block"); important(oldRail, "width", "auto"); important(oldRail, "min-width", "0");

      const nativeChartHeading = chart.firstElementChild as HTMLElement | null;
      if (nativeChartHeading && !nativeChartHeading.classList.contains("bc2-panel-heading")) important(nativeChartHeading, "display", "none");
      if (!chart.querySelector(".bc2-panel-heading")) {
        const heading = document.createElement("div"); heading.className = "bc2-panel-heading";
        heading.innerHTML = `<div><span>LIVE CHART · TRUE BEARINGS</span><h2>Navigation picture</h2></div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/></svg>`; chart.prepend(heading);
      }
      let tools = document.getElementById("bc-chart-tools");
      if (!tools) { tools = document.createElement("div"); tools.id = "bc-chart-tools"; tools.innerHTML = `<button id="bc-chart-ownship">OWN SHIP</button><button id="bc-chart-routefit">ROUTE FIT</button><button id="bc-chart-projection">VECTOR ON</button><button id="bc-chart-ais">AIS ON</button>`; chart.appendChild(tools); }
      const updateButtons = () => { const v = document.getElementById("bc-chart-projection"), a = document.getElementById("bc-chart-ais"); if (v) v.textContent = `VECTOR ${vectorVisible ? "ON" : "OFF"}`; if (a) a.textContent = `AIS ${aisVisible ? "ON" : "OFF"}`; };
      const updateOverlays = () => Array.from(map.querySelectorAll<SVGElement>("path,circle")).filter((el) => (el.getAttribute("stroke") || "").toLowerCase() === "#22d3ee").forEach((el) => { const vector = Boolean((el.getAttribute("stroke-dasharray") || "").trim()); el.style.display = aisVisible && (!vector || vectorVisible) ? "" : "none"; });
      const own = document.getElementById("bc-chart-ownship") as HTMLButtonElement | null; if (own) own.onclick = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === "Center Own Ship")?.click();
      const fit = document.getElementById("bc-chart-routefit") as HTMLButtonElement | null; if (fit) fit.onclick = () => map.querySelector<HTMLElement>(".leaflet-control-zoom-out")?.click();
      const vector = document.getElementById("bc-chart-projection") as HTMLButtonElement | null; if (vector) vector.onclick = () => { vectorVisible = !vectorVisible; updateButtons(); updateOverlays(); };
      const ais = document.getElementById("bc-chart-ais") as HTMLButtonElement | null; if (ais) ais.onclick = () => { aisVisible = !aisVisible; updateButtons(); updateOverlays(); };
      updateButtons(); overlayObserver?.disconnect(); overlayObserver = new MutationObserver(updateOverlays); overlayObserver.observe(map, { childList: true, subtree: true });

      let instruments = document.getElementById("bc-v2-instruments");
      if (!instruments && oldRail) {
        instruments = document.createElement("section"); instruments.id = "bc-v2-instruments";
        instruments.innerHTML = `<div class="bc2-rail-heading"><div><span>LIVE INSTRUMENTS</span><h2>Vessel and voyage</h2></div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="7"/></svg></div><div class="bc2-voyage"><label>ROUTE / DESTINATION</label><b id="bc2-route">No route loaded</b><small id="bc2-dest">--</small></div><div class="bc2-big-grid"><div><label>HEADING</label><strong id="bc2-hdg">--</strong></div><div><label>CROSS TRACK ERROR</label><strong id="bc2-xte">--</strong></div></div><div class="bc2-leg"><label>ACTIVE LEG</label><strong id="bc2-leg">--</strong><small id="bc2-legname">--</small></div><div class="bc2-small-grid"><div><label>DISTANCE TO GO</label><strong id="bc2-dtg">--</strong></div><div><label>ETA</label><strong id="bc2-eta">--</strong></div><div><label>LEG BEARING</label><strong id="bc2-brg">--</strong></div><div><label>CORRIDOR</label><strong>2.0 NM</strong></div></div>`; oldRail.prepend(instruments);
      }
      const sync = () => {
        const routeName = route.querySelector<HTMLElement>(".text-wardGold")?.textContent?.trim() || "No route loaded", destination = valueFor(route, "Route / Destination").replace(routeName, "").trim() || "--", ship = valueFor(route, "Own Ship Position"), dtg = valueFor(route, "DTG"), eta = valueFor(route, "ETA"), xte = valueFor(route, "XTE"), bearing = valueFor(route, "Leg BRG");
        const activeText = activeLeg?.querySelector<HTMLElement>(".text-wardGold")?.textContent?.trim() || "--", activeName = activeLeg ? Array.from(activeLeg.querySelectorAll<HTMLElement>("div")).map((el) => el.textContent?.trim() || "").find((text) => text.includes("→") && text !== activeText) || "--" : "--";
        const cog = ship.match(/([0-9.]+)° COG/)?.[1], sog = ship.match(/([0-9.]+) kt/)?.[1], hdg = ship.match(/HDG ([0-9.]+)°/)?.[1], coord = ship.split("/")[0]?.trim() || "--", coords = coord.match(/^(.+?[NS])\s+(.+?[EW])$/i), now = new Date();
        const set = (id: string, text: string) => { const el = document.getElementById(id); if (el) el.textContent = text || "--"; };
        set("bc2-utc", `${now.toLocaleTimeString("en-US", { timeZone: "UTC", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}Z`); set("bc2-date", now.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short", year: "numeric" }).toUpperCase());
        set("bc2-lat", coords?.[1] || coord); set("bc2-lon", coords?.[2] || "--"); set("bc2-cog", cog ? `${cog}°` : "--"); set("bc2-sog", sog ? `${sog} KT` : "--"); set("bc2-hdg", hdg ? `${hdg}°` : "--"); set("bc2-xte", xte); set("bc2-route", routeName); set("bc2-dest", destination); set("bc2-leg", activeText); set("bc2-legname", activeName); set("bc2-dtg", dtg); set("bc2-eta", eta); set("bc2-brg", bearing); set("bc2-watch-leg", activeText); set("bc2-watch-brg", `BRG ${bearing}`); set("bc2-watch-dtg", dtg); set("bc2-watch-eta", `ETA ${eta}`);
      };
      sync(); syncTimer = window.setInterval(sync, 1000); mapObserver?.disconnect(); mapObserver = new ResizeObserver(recoverMap); mapObserver.observe(map); window.addEventListener("resize", recoverMap); (map as HTMLElement & { __tsRecover?: () => void }).__tsRecover = recoverMap; [0, 100, 350, 900].forEach((delay) => window.setTimeout(recoverMap, delay));
    };
    apply();
    return () => { window.clearTimeout(retryTimer); window.clearTimeout(mapResizeTimer); window.clearInterval(syncTimer); mapObserver?.disconnect(); overlayObserver?.disconnect(); const map = document.getElementById("v12-map") as (HTMLElement & { __tsRecover?: () => void }) | null; if (map?.__tsRecover) window.removeEventListener("resize", map.__tsRecover); style.remove(); };
  }, []);
  return null;
}
