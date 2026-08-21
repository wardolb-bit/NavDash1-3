"use client";

import { useEffect } from "react";

function setImportant(el: HTMLElement | null, property: string, value: string) {
  if (!el) return;
  el.style.setProperty(property, value, "important");
}

function valueFor(root: HTMLElement, label: string) {
  const labelEl = Array.from(root.querySelectorAll<HTMLElement>("div")).find((el) => el.textContent?.trim() === label);
  const box = labelEl?.parentElement as HTMLElement | null;
  if (!box) return "--";
  const lines = Array.from(box.children).map((el) => (el as HTMLElement).textContent?.trim() || "").filter((text) => text && text !== label);
  return lines.join(" ") || "--";
}

export function BridgeConsolePreview() {
  useEffect(() => {
    let attempts = 0;
    let retryTimer = 0;
    let syncTimer = 0;
    let mapResizeTimer = 0;
    let mapObserver: ResizeObserver | null = null;

    const recoverMapTiles = (map: HTMLElement) => {
      window.clearTimeout(mapResizeTimer);
      mapResizeTimer = window.setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
        map.querySelectorAll<HTMLImageElement>(".leaflet-tile-pane img.leaflet-tile").forEach((tile) => {
          if (!tile.src) return;
          const src = tile.src;
          tile.removeAttribute("src");
          window.requestAnimationFrame(() => { tile.src = src; });
        });
      }, 180);
    };

    const apply = () => {
      attempts += 1;
      const shell = document.querySelector<HTMLElement>(".navdash-v12-day, .navdash-v12-night");
      const chart = document.getElementById("v12-section-chart") as HTMLElement | null;
      const map = document.getElementById("v12-map") as HTMLElement | null;
      const route = document.getElementById("v12-section-route") as HTMLElement | null;
      if (!shell || !chart || !map || !route) {
        if (attempts < 80) retryTimer = window.setTimeout(apply, 100);
        return;
      }

      const globalNav = document.querySelector<HTMLElement>("body > nav");
      if (globalNav) setImportant(globalNav, "display", "none");
      setImportant(shell, "padding", "6px");
      setImportant(shell, "background", "#04080c");

      const children = Array.from(shell.children) as HTMLElement[];
      const header = children.find((el) => el.tagName === "HEADER") || null;
      const navStrip = header?.nextElementSibling as HTMLElement | null;
      const mainGrid = navStrip?.nextElementSibling as HTMLElement | null;
      const oldRail = route.parentElement as HTMLElement | null;
      const activeLeg = route.nextElementSibling as HTMLElement | null;

      let topbar = document.getElementById("bc-v2-topbar") as HTMLElement | null;
      if (!topbar) {
        topbar = document.createElement("div");
        topbar.id = "bc-v2-topbar";
        topbar.innerHTML = `<div class="bc2-brand"><span class="bc2-logo">N</span><span><b>NAVDASH</b><small>M/V MB480 · BRIDGE CONSOLE</small></span></div><div class="bc2-center"><span class="live"><i></i>AIS LIVE</span><span>ROUTE ACTIVE</span><span>WX NORMAL</span></div><div class="bc2-clock">NAVIGATION</div>`;
        shell.insertBefore(topbar, shell.firstChild);
      }
      topbar.style.cssText = "height:46px;display:grid;grid-template-columns:260px 1fr 180px;align-items:center;padding:0 12px;margin-bottom:5px;border:1px solid rgba(201,162,39,.3);background:#071019;color:#e7edf3;font:700 11px system-ui;letter-spacing:.08em";
      const topBrand = topbar.querySelector<HTMLElement>(".bc2-brand"); if (topBrand) topBrand.style.cssText = "display:flex;align-items:center;gap:9px";
      const logo = topbar.querySelector<HTMLElement>(".bc2-logo"); if (logo) logo.style.cssText = "display:grid;place-items:center;width:28px;height:28px;border:1px solid #c9a227;color:#e7c95c;font-size:15px;font-weight:900";
      const brandStack = topbar.querySelector<HTMLElement>(".bc2-brand span:last-child"); if (brandStack) brandStack.style.cssText = "display:flex;flex-direction:column;line-height:1";
      const brandSmall = topbar.querySelector<HTMLElement>("small"); if (brandSmall) brandSmall.style.cssText = "margin-top:4px;font-size:8px;color:#8294a5;letter-spacing:.14em";
      const topCenter = topbar.querySelector<HTMLElement>(".bc2-center"); if (topCenter) topCenter.style.cssText = "display:flex;justify-content:center;gap:8px";
      topbar.querySelectorAll<HTMLElement>(".bc2-center span").forEach((chip) => chip.style.cssText = "padding:5px 9px;border:1px solid rgba(148,163,184,.18);background:#050a0f;color:#aebdca;font-size:9px");
      const liveDot = topbar.querySelector<HTMLElement>(".live i"); if (liveDot) liveDot.style.cssText = "display:inline-block;width:6px;height:6px;border-radius:50%;background:#34d399;margin-right:6px;box-shadow:0 0 8px rgba(52,211,153,.55)";
      const clock = topbar.querySelector<HTMLElement>(".bc2-clock"); if (clock) clock.style.cssText = "text-align:right;color:#e7c95c;font-size:9px;letter-spacing:.16em";

      if (header) {
        const row = header.firstElementChild as HTMLElement | null;
        const branding = row?.firstElementChild as HTMLElement | null;
        if (branding) setImportant(branding, "display", "none");
        [ ["padding","4px 6px"],["margin","0 0 5px"],["border-radius","0"],["background","#071019"],["box-shadow","none"] ].forEach(([p,v]) => setImportant(header,p,v));
        if (row) { setImportant(row,"display","flex"); setImportant(row,"justify-content","flex-end"); setImportant(row,"align-items","center"); setImportant(row,"gap","5px"); }
        header.querySelectorAll<HTMLElement>("button,label").forEach((control) => { setImportant(control,"width","auto"); setImportant(control,"min-width","86px"); setImportant(control,"height","30px"); setImportant(control,"padding","0 8px"); setImportant(control,"border-radius","3px"); setImportant(control,"font-size","10px"); setImportant(control,"box-shadow","none"); });
      }

      if (mainGrid) { setImportant(mainGrid,"display","grid"); setImportant(mainGrid,"grid-template-columns","minmax(0,1fr) 330px"); setImportant(mainGrid,"gap","5px"); setImportant(mainGrid,"align-items","stretch"); }
      setImportant(chart,"padding","0"); setImportant(chart,"margin","0"); setImportant(chart,"border-radius","0"); setImportant(chart,"border","1px solid rgba(148,163,184,.14)"); setImportant(chart,"background","#071019"); setImportant(chart,"box-shadow","none");
      const chartHead = chart.firstElementChild as HTMLElement | null; if (chartHead) setImportant(chartHead,"display","none");
      const note = map.nextElementSibling as HTMLElement | null; if (note) setImportant(note,"display","none");
      setImportant(map,"width","100%"); setImportant(map,"height","calc(100vh - 122px)"); setImportant(map,"min-height","650px"); setImportant(map,"border-radius","0"); setImportant(map,"border","0"); setImportant(map,"background","#0a141d");

      if (oldRail) { setImportant(oldRail,"display","block"); setImportant(oldRail,"width","330px"); setImportant(oldRail,"min-width","330px"); }
      setImportant(route,"display","none"); if (activeLeg) setImportant(activeLeg,"display","none");

      let instruments = document.getElementById("bc-v2-instruments") as HTMLElement | null;
      if (!instruments && oldRail) { instruments = document.createElement("section"); instruments.id = "bc-v2-instruments"; oldRail.insertBefore(instruments, oldRail.firstChild); }
      if (instruments) {
        instruments.style.cssText = "height:100%;min-height:650px;display:flex;flex-direction:column;border:1px solid rgba(148,163,184,.14);background:#071019;color:#dbe5ee;font-family:system-ui,sans-serif";
        instruments.innerHTML = `<div class="bc2-rail-title"><span>VOYAGE</span><b id="bc2-route">--</b><small id="bc2-dest">--</small></div><div class="bc2-pos"><label>OWN SHIP</label><strong id="bc2-pos">--</strong><small id="bc2-motion">--</small></div><div class="bc2-big-grid"><div><label>COG</label><strong id="bc2-cog">--</strong></div><div><label>SOG</label><strong id="bc2-sog">--</strong></div><div><label>HDG</label><strong id="bc2-hdg">--</strong></div><div><label>XTE</label><strong id="bc2-xte">--</strong></div></div><div class="bc2-leg"><label>ACTIVE LEG</label><strong id="bc2-leg">--</strong><small id="bc2-legname">--</small></div><div class="bc2-small-grid"><div><label>DTG</label><strong id="bc2-dtg">--</strong></div><div><label>ETA</label><strong id="bc2-eta">--</strong></div><div><label>BRG</label><strong id="bc2-brg">--</strong></div><div><label>CORRIDOR</label><strong>2.0 NM</strong></div></div><div class="bc2-wx"><span>WX</span><b>NORMAL</b><small>Open Weather for operational detail</small></div>`;
        instruments.querySelectorAll<HTMLElement>("label").forEach((el) => el.style.cssText = "display:block;margin-bottom:4px;color:#708496;font-size:8px;font-weight:900;letter-spacing:.16em");
        const railTitle = instruments.querySelector<HTMLElement>(".bc2-rail-title"); if (railTitle) railTitle.style.cssText = "padding:12px;border-bottom:1px solid rgba(148,163,184,.14)";
        const rtSpan = railTitle?.querySelector<HTMLElement>("span"); if (rtSpan) rtSpan.style.cssText = "display:block;color:#c9a227;font-size:8px;font-weight:900;letter-spacing:.16em;margin-bottom:7px";
        const rtB = railTitle?.querySelector<HTMLElement>("b"); if (rtB) rtB.style.cssText = "display:block;font-size:16px;color:#e7c95c;line-height:1.1";
        const rtS = railTitle?.querySelector<HTMLElement>("small"); if (rtS) rtS.style.cssText = "display:block;margin-top:5px;color:#9aabba;font-size:10px";
        const posBox = instruments.querySelector<HTMLElement>(".bc2-pos"); if (posBox) posBox.style.cssText = "padding:12px;border-bottom:1px solid rgba(148,163,184,.14)";
        const posStrong = posBox?.querySelector<HTMLElement>("strong"); if (posStrong) posStrong.style.cssText = "display:block;color:#42d3c8;font-size:15px;line-height:1.2";
        const posSmall = posBox?.querySelector<HTMLElement>("small"); if (posSmall) posSmall.style.cssText = "display:block;margin-top:5px;color:#8fa0af;font-size:9px";
        const big = instruments.querySelector<HTMLElement>(".bc2-big-grid"); if (big) big.style.cssText = "display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid rgba(148,163,184,.14)";
        big?.querySelectorAll<HTMLElement>(":scope > div").forEach((cell,i) => cell.style.cssText = `padding:13px 12px;min-height:86px;${i%2===0?"border-right:1px solid rgba(148,163,184,.14);":""}${i<2?"border-bottom:1px solid rgba(148,163,184,.14);":""}`);
        big?.querySelectorAll<HTMLElement>("strong").forEach((el) => el.style.cssText = "display:block;font-size:28px;line-height:1;color:#edf4fa;font-weight:800");
        const leg = instruments.querySelector<HTMLElement>(".bc2-leg"); if (leg) leg.style.cssText = "padding:12px;border-bottom:1px solid rgba(148,163,184,.14)";
        const legStrong = leg?.querySelector<HTMLElement>("strong"); if (legStrong) legStrong.style.cssText = "display:block;color:#e7c95c;font-size:21px;line-height:1";
        const legSmall = leg?.querySelector<HTMLElement>("small"); if (legSmall) legSmall.style.cssText = "display:block;margin-top:5px;color:#aab8c4;font-size:9px";
        const smallGrid = instruments.querySelector<HTMLElement>(".bc2-small-grid"); if (smallGrid) smallGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid rgba(148,163,184,.14)";
        smallGrid?.querySelectorAll<HTMLElement>(":scope > div").forEach((cell,i) => cell.style.cssText = `padding:10px 12px;${i%2===0?"border-right:1px solid rgba(148,163,184,.14);":""}${i<2?"border-bottom:1px solid rgba(148,163,184,.14);":""}`);
        smallGrid?.querySelectorAll<HTMLElement>("strong").forEach((el) => el.style.cssText = "font-size:16px;color:#edf4fa");
        const wx = instruments.querySelector<HTMLElement>(".bc2-wx"); if (wx) wx.style.cssText = "margin-top:auto;padding:12px;background:#050b10";
        const wxSpan = wx?.querySelector<HTMLElement>("span"); if (wxSpan) wxSpan.style.cssText = "color:#708496;font-size:8px;font-weight:900;letter-spacing:.16em;margin-right:8px";
        const wxB = wx?.querySelector<HTMLElement>("b"); if (wxB) wxB.style.cssText = "color:#34d399;font-size:11px";
        const wxSmall = wx?.querySelector<HTMLElement>("small"); if (wxSmall) wxSmall.style.cssText = "display:block;margin-top:5px;color:#728596;font-size:9px";
      }

      if (navStrip && mainGrid) { mainGrid.insertAdjacentElement("afterend",navStrip); setImportant(navStrip,"display","grid"); setImportant(navStrip,"grid-template-columns","repeat(4,minmax(0,1fr))"); setImportant(navStrip,"gap","4px"); setImportant(navStrip,"margin","5px 0 0"); navStrip.querySelectorAll<HTMLElement>("button").forEach((button)=>{setImportant(button,"padding","7px 8px");setImportant(button,"border-radius","0");setImportant(button,"font-size","9px");}); }

      const sync = () => {
        const routeName = route.querySelector<HTMLElement>(".text-wardGold")?.textContent?.trim() || "No route loaded";
        const destination = valueFor(route,"Route / Destination").replace(routeName,"").trim() || "--";
        const own = valueFor(route,"Own Ship Position"); const dtg=valueFor(route,"DTG"); const eta=valueFor(route,"ETA"); const xte=valueFor(route,"XTE"); const brg=valueFor(route,"Leg BRG");
        const activeText=activeLeg?.querySelector<HTMLElement>(".text-wardGold")?.textContent?.trim()||"--";
        const activeName=activeLeg?Array.from(activeLeg.querySelectorAll<HTMLElement>("div")).map((el)=>el.textContent?.trim()||"").find((t)=>t.includes("→")&&t!==activeText)||"--":"--";
        const ownParts=own.split("/").map((s)=>s.trim()); const motion=ownParts.slice(1).join(" / ")||"--"; const cog=own.match(/([0-9.]+)° COG/)?.[1]; const sog=own.match(/([0-9.]+) kt/)?.[1]; const hdg=own.match(/HDG ([0-9.]+)°/)?.[1]; const position=ownParts[0]||own;
        const setText=(id:string,text:string)=>{const el=document.getElementById(id);if(el)el.textContent=text||"--";};
        setText("bc2-route",routeName);setText("bc2-dest",destination);setText("bc2-pos",position);setText("bc2-motion",motion);setText("bc2-cog",cog?`${cog}°`:"--");setText("bc2-sog",sog?`${sog} KT`:"--");setText("bc2-hdg",hdg?`${hdg}°`:"--");setText("bc2-xte",xte);setText("bc2-leg",activeText);setText("bc2-legname",activeName);setText("bc2-dtg",dtg);setText("bc2-eta",eta);setText("bc2-brg",brg);
      };
      sync(); syncTimer=window.setInterval(sync,1000);

      mapObserver?.disconnect();
      mapObserver = new ResizeObserver(() => recoverMapTiles(map));
      mapObserver.observe(map);
      const recoverOnWindowResize = () => recoverMapTiles(map);
      window.addEventListener("resize", recoverOnWindowResize);
      (map as any).__bcRecoverOnWindowResize = recoverOnWindowResize;

      const oldBadge=document.getElementById("bridge-console-runtime-badge"); oldBadge?.remove();
      for(const delay of [0,100,350,900]) window.setTimeout(()=>{window.dispatchEvent(new Event("resize"));recoverMapTiles(map);},delay);
    };

    apply();
    return () => {
      window.clearTimeout(retryTimer); window.clearTimeout(mapResizeTimer); window.clearInterval(syncTimer); mapObserver?.disconnect();
      const map=document.getElementById("v12-map") as any; if(map?.__bcRecoverOnWindowResize) window.removeEventListener("resize",map.__bcRecoverOnWindowResize);
    };
  }, []);
  return null;
}
