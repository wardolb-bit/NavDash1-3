import './globals.css';
import type { Metadata } from 'next';
import Script from 'next/script';
import { NavDashNav } from '../components/NavDashNav';

export const metadata: Metadata = {
  title: 'M/V MB480 NavDash 1.3',
  description: 'M/V MB480 navigation dashboard with AIS, route, weather, and watch tools.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
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

        <Script id="navdash-preview-destination-eta" strategy="afterInteractive">
          {`
            (() => {
              const ROUTE_KEYS = ["navconsole-saved-route", "navdash-v12-loaded-route"];

              function readDestination() {
                for (const key of ROUTE_KEYS) {
                  try {
                    const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
                    if (!raw) continue;
                    const parsed = JSON.parse(raw);
                    const waypoints = Array.isArray(parsed?.waypoints) ? parsed.waypoints : [];
                    if (!waypoints.length) continue;
                    const last = waypoints[waypoints.length - 1];
                    const lat = Number(last?.lat ?? last?.latitude);
                    const lon = Number(last?.lon ?? last?.lng ?? last?.longitude);
                    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
                  } catch {}
                }
                return null;
              }

              function timeZoneFor(lat, lon) {
                if (lat >= 18 && lat <= 23.5 && lon >= -161.5 && lon <= -154.5) return "Pacific/Honolulu";
                if (lat >= 12 && lat <= 21 && lon >= 143 && lon <= 146.5) return "Pacific/Guam";
                if (lat >= 24 && lat <= 46 && lon >= 123 && lon <= 146) return "Asia/Tokyo";
                if (lat >= 4 && lat <= 22 && lon >= 116 && lon <= 127) return "Asia/Manila";
                if (lat >= 21 && lat <= 26 && lon >= 119 && lon <= 123) return "Asia/Taipei";
                if (lat >= 5 && lat <= 11 && lon >= 133 && lon <= 135.5) return "Pacific/Palau";
                if (lat >= 5 && lat <= 11 && lon >= 150 && lon < 156) return "Pacific/Chuuk";
                if (lat >= 5 && lat <= 9 && lon >= 156 && lon < 161) return "Pacific/Pohnpei";
                if (lat >= 4 && lat <= 7 && lon >= 161 && lon < 164.5) return "Pacific/Kosrae";
                if (lat >= 4 && lat <= 15 && lon >= 164.5 && lon <= 173.5) return "Pacific/Majuro";
                if (lat >= 18 && lat <= 23.5 && lon >= -161.5 && lon <= -154.5) return "Pacific/Honolulu";
                if (lat >= 30 && lat <= 50 && lon >= -126 && lon <= -114) return "America/Los_Angeles";
                if (lat >= 24 && lat <= 50 && lon > -114 && lon <= -101) return "America/Denver";
                if (lat >= 24 && lat <= 50 && lon > -101 && lon <= -84) return "America/Chicago";
                if (lat >= 24 && lat <= 50 && lon > -84 && lon <= -66) return "America/New_York";
                if (lat >= 51 && lat <= 72 && lon >= -170 && lon <= -129) return "America/Anchorage";

                const offset = Math.max(-12, Math.min(14, Math.round(lon / 15)));
                const etcSign = offset > 0 ? "-" : offset < 0 ? "+" : "";
                return offset === 0 ? "UTC" : `Etc/GMT${etcSign}${Math.abs(offset)}`;
              }

              function zonePart(date, timeZone, style) {
                try {
                  return new Intl.DateTimeFormat("en-US", {
                    timeZone,
                    timeZoneName: style,
                    hour: "2-digit",
                  }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value || "";
                } catch {
                  return "";
                }
              }

              function normalizeOffset(value) {
                if (!value) return "UTC";
                return value.replace(/^GMT/, "UTC").replace("-", "−");
              }

              function updateEta() {
                if (location.pathname !== "/") return;
                const destination = readDestination();
                if (!destination) return;

                const labels = Array.from(document.querySelectorAll("div")).filter(
                  (node) => node.textContent?.trim() === "ETA" || node.textContent?.trim() === "ETA · Destination Local"
                );

                for (const label of labels) {
                  const card = label.parentElement;
                  if (!card) continue;
                  const value = card.children[1];
                  if (!value) continue;
                  const match = value.textContent?.trim().match(/^(\\d+)h\\s+(\\d+)m$/i);
                  if (!match) continue;

                  const hours = Number(match[1]);
                  const minutes = Number(match[2]);
                  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) continue;

                  const arrival = new Date(Date.now() + (hours * 60 + minutes) * 60 * 1000);
                  const timeZone = timeZoneFor(destination.lat, destination.lon);

                  const dateText = new Intl.DateTimeFormat("en-US", {
                    timeZone,
                    month: "short",
                    day: "2-digit",
                  }).format(arrival).toUpperCase();

                  const timeText = new Intl.DateTimeFormat("en-US", {
                    timeZone,
                    hour: "2-digit",
                    minute: "2-digit",
                    hourCycle: "h23",
                  }).format(arrival).replace(":", "");

                  const shortZone = zonePart(arrival, timeZone, "short") || timeZone;
                  const longZone = zonePart(arrival, timeZone, "long") || timeZone.replace(/_/g, " ");
                  const offset = normalizeOffset(zonePart(arrival, timeZone, "longOffset"));

                  label.textContent = "ETA · Destination Local";
                  value.textContent = `${dateText} ${timeText}`;

                  let zoneLine = card.querySelector("[data-destination-eta-zone]");
                  if (!zoneLine) {
                    zoneLine = document.createElement("div");
                    zoneLine.setAttribute("data-destination-eta-zone", "true");
                    zoneLine.className = "mt-1 text-xs font-black text-slate-400";
                    card.appendChild(zoneLine);
                  }
                  zoneLine.textContent = `${shortZone} · ${offset}`;

                  let descriptionLine = card.querySelector("[data-destination-eta-description]");
                  if (!descriptionLine) {
                    descriptionLine = document.createElement("div");
                    descriptionLine.setAttribute("data-destination-eta-description", "true");
                    descriptionLine.className = "mt-1 text-xs text-slate-400";
                    card.appendChild(descriptionLine);
                  }
                  descriptionLine.textContent = `${longZone} · ${timeZone}`;
                }
              }

              const observer = new MutationObserver(() => updateEta());
              observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
              window.setInterval(updateEta, 30000);
              window.setTimeout(updateEta, 800);
            })();
          `}
        </Script>

        <NavDashNav />
        {children}
      </body>
    </html>
  );
}
