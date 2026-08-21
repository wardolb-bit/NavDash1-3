import './globals.css';
import './bridge-console.css';
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

        <NavDashNav />
        {children}
      </body>
    </html>
  );
}
