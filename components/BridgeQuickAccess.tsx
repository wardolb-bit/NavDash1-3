"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function BridgeQuickAccess() {
  const pathname = usePathname();
  if (pathname !== "/") return null;

  const enterFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {}
  };

  return (
    <div id="bc-quick-access" className="fixed right-3 top-[9px] z-[100000] flex items-center gap-1">
      <Link href="/wx" className="bc-quick-link">WEATHER</Link>
      <Link href="/position-report" className="bc-quick-link">POSITION REPORT</Link>
      <Link href="/official-weather" className="bc-quick-link bc-quick-secondary">OFFICIAL WX</Link>
      <button type="button" onClick={enterFullscreen} className="bc-quick-link bc-quick-secondary">FULLSCREEN</button>
    </div>
  );
}
