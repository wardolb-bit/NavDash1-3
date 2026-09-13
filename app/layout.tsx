import './globals.css';
import './bridge-console.css';
import './day-fixes.css';
import './global-theme.css';
import type { Metadata } from 'next';
import Script from 'next/script';
import { BridgeConsoleRouteGate } from '../components/BridgeConsoleRouteGate';
import { WxRoutingBridgeSkin } from '../components/WxRoutingBridgeSkin';
import { CelestialConsoleSkin } from '../components/CelestialConsoleSkin';
import { CelestialSunMoon } from '../components/CelestialSunMoon';
import { SharedAmiForecastSync } from '../components/SharedAmiForecastSync';

export const metadata: Metadata = {
  title: 'M/V MB480 NavDash 1.3',
  description: 'M/V MB480 navigation dashboard with AIS, route, weather, and watch tools.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script id="navdash-theme-bootstrap" strategy="beforeInteractive">
          {`
            (() => {
              try {
                const saved = localStorage.getItem("navConsoleTheme");
                const theme = saved === "day" ? "day" : "bridge-night";
                document.documentElement.setAttribute("data-navdash-theme", theme);
              } catch {
                document.documentElement.setAttribute("data-navdash-theme", "bridge-night");
              }
            })();
          `}
        </Script>

        <Script id="navdash-map-tools-behavior" strategy="afterInteractive">
          {`
            (() => {
              let activeMap = null;
              let contextMenu = null;
              let longPressTimer = 0;
              let pointerStart = null;

              const getMap = () => document.getElementById("v12-map");
              const getMapSurface = () => document.getElementById("navmap-main-isolated-v2");
              const getTools = () => {
                const map = getMap();
                if (!map) return null;
                return Array.from(map.children).find((el) => {
                  const style = el.getAttribute("style") || "";
                  return /z-index:\\s*760/.test(style);
                }) || null;
              };

              const getControlGroup = () => {
                const tools = getTools();
                return tools instanceof HTMLElement ? tools.firstElementChild : null;
              };

              const getOriginalButton = (label) => {
                const group = getControlGroup();
                if (!(group instanceof HTMLElement)) return null;
                return Array.from(group.querySelectorAll("button")).find((button) =>
                  (button.textContent || "").trim().toUpperCase() === label
                ) || null;
              };

              const getOriginalToggle = (label) => {
                const group = getControlGroup();
                if (!(group instanceof HTMLElement)) return null;
                return Array.from(group.querySelectorAll("label")).find((item) =>
                  (item.textContent || "").trim().toUpperCase().includes(label)
                ) || null;
              };

              const syncMeasureReadout = () => {
                const map = getMap();
                if (!map) return;
                const label = map.querySelector(".navmap-measure-label");
                let readout = document.getElementById("navdash-measure-readout");

                if (!(label instanceof HTMLElement) || !label.textContent?.trim()) {
                  readout?.remove();
                  return;
                }

                label.style.setProperty("display", "none", "important");

                if (!(readout instanceof HTMLElement)) {
                  readout = document.createElement("div");
                  readout.id = "navdash-measure-readout";
                  readout.style.cssText = "position:absolute;top:72px;right:12px;z-index:1200;padding:7px 10px;border:1px solid #22d3ee;background:rgba(7,16,25,.94);color:#d9fbff;border-radius:4px;font:700 12px/1.2 system-ui,sans-serif;letter-spacing:.02em;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.25)";
                  map.appendChild(readout);
                }

                readout.textContent = label.textContent.trim();
              };

              const hideFloatingButtons = () => {
                const group = getControlGroup();
                if (group instanceof HTMLElement) group.style.setProperty("display", "none", "important");
              };

              const closeMenu = () => {
                contextMenu?.remove();
                contextMenu = null;
              };

              const menuTheme = () => document.documentElement.getAttribute("data-navdash-theme") === "day"
                ? {
                    background: "rgba(255,255,255,.98)",
                    border: "rgba(15,23,42,.22)",
                    text: "#17212b",
                    muted: "#586773",
                    hover: "#f3f6f8",
                    active: "#006f78",
                  }
                : {
                    background: "rgba(5,12,18,.97)",
                    border: "rgba(241,213,107,.38)",
                    text: "#e7edf3",
                    muted: "#91a0ad",
                    hover: "#15212c",
                    active: "#22d3ee",
                  };

              const invokeButton = (label, returnToPan = false) => {
                const button = getOriginalButton(label);
                if (button instanceof HTMLButtonElement && !button.disabled) button.click();
                if (returnToPan) {
                  const pan = getOriginalButton("PAN");
                  if (pan instanceof HTMLButtonElement && !pan.disabled) pan.click();
                }
                closeMenu();
                window.setTimeout(syncMeasureReadout, 60);
              };

              const invokeToggle = (label) => {
                const toggle = getOriginalToggle(label);
                const checkbox = toggle?.querySelector('input[type="checkbox"]');
                if (checkbox instanceof HTMLInputElement && !checkbox.disabled) checkbox.click();
                closeMenu();
              };

              const buildMenuItem = (menu, text, action, options = {}) => {
                const theme = menuTheme();
                const row = document.createElement("button");
                row.type = "button";
                row.textContent = text;
                row.disabled = Boolean(options.disabled);
                row.style.cssText = "display:flex;width:100%;min-width:190px;align-items:center;justify-content:space-between;border:0;background:transparent;padding:10px 12px;text-align:left;font:700 11px/1.2 system-ui,sans-serif;letter-spacing:.07em;cursor:pointer;border-radius:4px";
                row.style.color = options.active ? theme.active : options.disabled ? theme.muted : theme.text;
                row.style.opacity = options.disabled ? "0.45" : "1";
                if (!options.disabled) {
                  row.addEventListener("mouseenter", () => { row.style.background = theme.hover; });
                  row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
                  row.addEventListener("click", action);
                }
                menu.appendChild(row);
              };

              const addSeparator = (menu) => {
                const theme = menuTheme();
                const line = document.createElement("div");
                line.style.cssText = "height:1px;margin:4px 6px";
                line.style.background = theme.border;
                menu.appendChild(line);
              };

              const openMenu = (clientX, clientY) => {
                const map = getMap();
                if (!(map instanceof HTMLElement)) return;
                closeMenu();

                const theme = menuTheme();
                const menu = document.createElement("div");
                menu.id = "navdash-map-context-menu";
                menu.setAttribute("role", "menu");
                menu.style.cssText = "position:absolute;z-index:1700;padding:6px;border-radius:7px;box-shadow:0 10px 28px rgba(0,0,0,.34);backdrop-filter:blur(8px);user-select:none;-webkit-user-select:none";
                menu.style.background = theme.background;
                menu.style.border = "1px solid " + theme.border;

                const group = getControlGroup();
                const pan = getOriginalButton("PAN");
                const fromShip = getOriginalButton("FROM SHIP");
                const twoPoints = getOriginalButton("TWO POINTS");
                const clearMeasure = getOriginalButton("CLEAR MEASURE");
                const sunLabel = getOriginalToggle("SUN EVENTS");
                const sunInput = sunLabel?.querySelector('input[type="checkbox"]');
                const amiLabel = getOriginalToggle("AMI WX");
                const amiInput = amiLabel?.querySelector('input[type="checkbox"]');

                if (!(group instanceof HTMLElement) || !(pan instanceof HTMLButtonElement)) return;

                buildMenuItem(menu, "PAN", () => invokeButton("PAN"), { active: pan.style.border.includes("34,211,238") });
                buildMenuItem(menu, "FROM SHIP", () => invokeButton("FROM SHIP"), { active: fromShip instanceof HTMLButtonElement && fromShip.style.border.includes("34,211,238"), disabled: !(fromShip instanceof HTMLButtonElement) });
                buildMenuItem(menu, "TWO POINTS", () => invokeButton("TWO POINTS"), { active: twoPoints instanceof HTMLButtonElement && twoPoints.style.border.includes("34,211,238"), disabled: !(twoPoints instanceof HTMLButtonElement) });
                buildMenuItem(menu, "CLEAR MEASURE", () => invokeButton("CLEAR MEASURE", true), { disabled: !(clearMeasure instanceof HTMLButtonElement) });
                addSeparator(menu);
                buildMenuItem(menu, "SUN EVENTS" + (sunInput instanceof HTMLInputElement && sunInput.checked ? "  ✓" : ""), () => invokeToggle("SUN EVENTS"), { active: sunInput instanceof HTMLInputElement && sunInput.checked, disabled: !(sunInput instanceof HTMLInputElement) });
                buildMenuItem(menu, "AMI WX" + (amiInput instanceof HTMLInputElement && amiInput.checked ? "  ✓" : ""), () => invokeToggle("AMI WX"), { active: amiInput instanceof HTMLInputElement && amiInput.checked, disabled: !(amiInput instanceof HTMLInputElement) || amiInput.disabled });

                map.appendChild(menu);
                contextMenu = menu;

                const rect = map.getBoundingClientRect();
                const menuRect = menu.getBoundingClientRect();
                const x = Math.max(6, Math.min(clientX - rect.left, rect.width - menuRect.width - 6));
                const y = Math.max(6, Math.min(clientY - rect.top, rect.height - menuRect.height - 6));
                menu.style.left = x + "px";
                menu.style.top = y + "px";
              };

              const cancelLongPress = () => {
                window.clearTimeout(longPressTimer);
                longPressTimer = 0;
                pointerStart = null;
              };

              const detachMapListeners = () => {
                if (!(activeMap instanceof HTMLElement)) return;
                activeMap.removeEventListener("contextmenu", activeMap.__navdashContextMenuHandler);
                activeMap.removeEventListener("pointerdown", activeMap.__navdashPointerDownHandler);
                activeMap.removeEventListener("pointermove", activeMap.__navdashPointerMoveHandler);
                activeMap.removeEventListener("pointerup", activeMap.__navdashPointerUpHandler);
                activeMap.removeEventListener("pointercancel", activeMap.__navdashPointerUpHandler);
                activeMap = null;
              };

              const attachMapListeners = () => {
                const surface = getMapSurface();
                if (!(surface instanceof HTMLElement) || surface === activeMap) return;
                detachMapListeners();
                activeMap = surface;

                const onContextMenu = (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openMenu(event.clientX, event.clientY);
                };

                const onPointerDown = (event) => {
                  if (event.pointerType !== "touch" || !event.isPrimary) return;
                  cancelLongPress();
                  pointerStart = { x: event.clientX, y: event.clientY };
                  longPressTimer = window.setTimeout(() => {
                    if (!pointerStart) return;
                    openMenu(pointerStart.x, pointerStart.y);
                    if (navigator.vibrate) navigator.vibrate(15);
                    cancelLongPress();
                  }, 650);
                };

                const onPointerMove = (event) => {
                  if (!pointerStart) return;
                  if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 12) cancelLongPress();
                };

                const onPointerUp = () => cancelLongPress();

                surface.__navdashContextMenuHandler = onContextMenu;
                surface.__navdashPointerDownHandler = onPointerDown;
                surface.__navdashPointerMoveHandler = onPointerMove;
                surface.__navdashPointerUpHandler = onPointerUp;
                surface.addEventListener("contextmenu", onContextMenu);
                surface.addEventListener("pointerdown", onPointerDown);
                surface.addEventListener("pointermove", onPointerMove);
                surface.addEventListener("pointerup", onPointerUp);
                surface.addEventListener("pointercancel", onPointerUp);
              };

              const mount = () => {
                hideFloatingButtons();
                attachMapListeners();
              };

              document.addEventListener("pointerdown", (event) => {
                if (contextMenu && event.target instanceof Node && !contextMenu.contains(event.target)) closeMenu();
              }, true);
              document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });
              document.addEventListener("click", () => window.setTimeout(syncMeasureReadout, 60), true);
              window.addEventListener("resize", () => { closeMenu(); window.setTimeout(syncMeasureReadout, 30); });

              mount();
              const observer = new MutationObserver(() => mount());
              observer.observe(document.body, { childList: true, subtree: true });
            })();
          `}
        </Script>

        <Script id="navdash-ami-clear-controls" strategy="afterInteractive">
          {`
            (() => {
              const STORAGE_KEY = "navdash-ami-route-forecast-v1";

              const clearAmiRoute = (button) => {
                try { localStorage.removeItem(STORAGE_KEY); } catch {}
                window.dispatchEvent(new CustomEvent("navdash-ami-overlay-updated", { detail: null }));
                if (button instanceof HTMLButtonElement) {
                  const original = button.textContent || "CLEAR AMI ROUTE";
                  button.textContent = "AMI ROUTE CLEARED";
                  window.setTimeout(() => { button.textContent = original; }, 1200);
                }
              };

              const getNavBriefButtonRow = () => {
                const page = document.querySelector(".navdash-navbrief-console");
                if (!(page instanceof HTMLElement)) return null;
                const header = page.querySelector("header");
                if (!(header instanceof HTMLElement)) return null;
                const buttonRow = Array.from(header.querySelectorAll("div")).find((el) =>
                  el.querySelector('button') && el.textContent?.includes("Refresh Inputs") && el.textContent?.includes("Print / PDF")
                );
                return buttonRow instanceof HTMLElement ? buttonRow : null;
              };

              const mountNavBriefMainButton = () => {
                if (document.getElementById("navdash-navbrief-main")) return;
                const buttonRow = getNavBriefButtonRow();
                if (!buttonRow) return;
                const button = document.createElement("button");
                button.id = "navdash-navbrief-main";
                button.type = "button";
                button.textContent = "MAIN";
                button.className = "border px-3 py-2 text-[11px] font-black uppercase tracking-[.08em] border-white/15 bg-[#101820] text-[#dbe5ee] hover:bg-[#182631]";
                button.addEventListener("click", () => { window.location.href = "/bridge"; });
                buttonRow.prepend(button);
              };

              const mountNavBriefButton = () => {
                if (document.getElementById("navdash-navbrief-clear-ami-route")) return;
                const buttonRow = getNavBriefButtonRow();
                if (!buttonRow) return;

                const button = document.createElement("button");
                button.id = "navdash-navbrief-clear-ami-route";
                button.type = "button";
                button.textContent = "CLEAR AMI ROUTE";
                button.className = "border border-[#c9a227]/70 bg-[#101820] px-3 py-2 text-[11px] font-black uppercase tracking-[.08em] text-[#f1d56b] hover:bg-[#182631]";
                button.addEventListener("click", () => clearAmiRoute(button));
                buttonRow.appendChild(button);
              };

              const renameNavBriefHeadings = () => {
                const page = document.querySelector(".navdash-navbrief-console");
                if (!(page instanceof HTMLElement)) return;
                page.querySelectorAll("div").forEach((el) => {
                  if (el.textContent === "WEATHER ROUTING STRATEGY") el.textContent = "WEATHER INFORMATION";
                  if (el.textContent === "ROUTING DECISION POINTS") el.textContent = "ROUTE REFERENCE POINTS";
                });
              };

              const mount = () => {
                mountNavBriefMainButton();
                mountNavBriefButton();
                renameNavBriefHeadings();
              };
              mount();
              const observer = new MutationObserver(() => mount());
              observer.observe(document.body, { childList: true, subtree: true });
              window.addEventListener("popstate", mount);
            })();
          `}
        </Script>

        <Script id="navconsole-fullscreen-manager" strategy="afterInteractive">
          {`
            (() => {
              const STORAGE_KEY = "navconsole-fullscreen";

              function syncFullscreenState() {
                try {
                  localStorage.setItem(
                    STORAGE_KEY,
                    document.fullscreenElement ? "true" : "false"
                  );
                } catch {}
              }

              async function restoreFullscreen() {
                try {
                  const shouldFullscreen =
                    localStorage.getItem(STORAGE_KEY) === "true";

                  if (
                    shouldFullscreen &&
                    !document.fullscreenElement
                  ) {
                    await document.documentElement.requestFullscreen();
                  }
                } catch {}
              }

              document.addEventListener(
                "fullscreenchange",
                syncFullscreenState
              );

              window.addEventListener("focus", restoreFullscreen);

              document.addEventListener("visibilitychange", () => {
                if (!document.hidden) {
                  restoreFullscreen();
                }
              });

              restoreFullscreen();
            })();
          `}
        </Script>

        {children}
        <BridgeConsoleRouteGate />
        <WxRoutingBridgeSkin />
        <CelestialConsoleSkin />
        <CelestialSunMoon />
        <SharedAmiForecastSync />
      </body>
    </html>
  );
}
