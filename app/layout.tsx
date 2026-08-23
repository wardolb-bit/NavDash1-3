import './globals.css';
import './bridge-console.css';
import './day-fixes.css';
import './global-theme.css';
import type { Metadata } from 'next';
import Script from 'next/script';
import { NavDashNav } from '../components/NavDashNav';
import { BridgeConsoleRouteGate } from '../components/BridgeConsoleRouteGate';
import { WxRoutingBridgeSkin } from '../components/WxRoutingBridgeSkin';

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

              const placeMeasureLabel = () => {
                const map = getMap();
                const label = map?.querySelector(".navmap-measure-label");
                if (!map || !(label instanceof HTMLElement)) return;
                const x = Math.max(12, map.clientWidth - label.offsetWidth - 14);
                label.style.setProperty("transform", `translate3d(${x}px, 58px, 0)`, "important");
                label.style.setProperty("margin", "0", "important");
                label.style.setProperty("z-index", "1200", "important");
              };

              document.addEventListener("click", (event) => {
                const tools = getTools();
                if (!(tools instanceof HTMLElement)) return;
                const target = event.target;
                if (target instanceof Node && tools.contains(target)) {
                  tools.setAttribute("data-map-tools-open", "true");
                }
              }, true);

              const observer = new MutationObserver(() => {
                placeMeasureLabel();
              });

              const start = () => {
                const map = getMap();
                if (!map) {
                  window.setTimeout(start, 150);
                  return;
                }
                observer.observe(map, { childList: true, subtree: true });
                placeMeasureLabel();
              };

              window.addEventListener("resize", placeMeasureLabel);
              start();
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
      </body>
    </html>
  );
}
