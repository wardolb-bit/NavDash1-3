import './globals.css';
import './bridge-console.css';
import './day-fixes.css';
import './global-theme.css';
import type { Metadata } from 'next';
import Script from 'next/script';
import { NavDashNav } from '../components/NavDashNav';
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
              const getMap = () => document.getElementById("v12-map");
              const getTools = () => {
                const map = getMap();
                if (!map) return null;
                return Array.from(map.children).find((el) => {
                  const style = el.getAttribute("style") || "";
                  return /z-index:\\s*760/.test(style);
                }) || null;
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

              document.addEventListener("click", (event) => {
                const tools = getTools();
                const target = event.target;

                if (tools instanceof HTMLElement && target instanceof Element) {
                  const button = target.closest("button");
                  if (button && tools.contains(button)) {
                    const firstButton = tools.querySelector("button");

                    if (button === firstButton) {
                      event.preventDefault();
                      event.stopPropagation();
                      if (tools.getAttribute("data-map-tools-open") === "true") {
                        tools.removeAttribute("data-map-tools-open");
                      } else {
                        tools.setAttribute("data-map-tools-open", "true");
                      }
                      if (button instanceof HTMLElement) button.blur();
                    }
                  }
                }

                window.setTimeout(syncMeasureReadout, 60);
              }, true);

              window.addEventListener("resize", () => window.setTimeout(syncMeasureReadout, 30));
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
                button.addEventListener("click", () => { window.location.href = "/"; });
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

              const mount = () => {
                mountNavBriefMainButton();
                mountNavBriefButton();
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

        <NavDashNav />
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