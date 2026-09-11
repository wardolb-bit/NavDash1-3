"use client";

import Link from "next/link";
import NavDashConsole from "../NavDashConsole";
import { MainMapAisTargets } from "../../components/MainMapAisTargets";
import { requestDesktopBridgeView } from "../../components/MobileBridgeRedirect";

export default function MobileBridgePage() {
  return (
    <div className="navdash-mobile-view">
      <style jsx global>{`
        body:has(.navdash-mobile-view) {
          overflow-x: hidden;
        }

        body:has(.navdash-mobile-view) .navdash-global-nav {
          display: none !important;
        }

        .navdash-mobile-view .navdash-current-console {
          padding: 4px !important;
          padding-bottom: 66px !important;
        }

        .navdash-mobile-view #bc-v2-topbar {
          height: auto !important;
          min-height: 48px !important;
          grid-template-columns: minmax(0, 1fr) auto !important;
          gap: 8px !important;
          padding: 6px 8px !important;
        }

        .navdash-mobile-view #bc-v2-topbar .bc2-brand {
          min-width: 0 !important;
        }

        .navdash-mobile-view #bc-v2-topbar .bc2-brand b {
          font-size: 13px !important;
        }

        .navdash-mobile-view #bc-v2-topbar .bc2-brand small {
          font-size: 7px !important;
        }

        .navdash-mobile-view #bc-v2-topbar .bc2-center {
          grid-column: 1 / -1 !important;
          order: 3 !important;
          justify-content: flex-start !important;
          overflow-x: auto !important;
          white-space: nowrap !important;
          padding-bottom: 1px !important;
          scrollbar-width: none;
        }

        .navdash-mobile-view #bc-v2-topbar .bc2-center::-webkit-scrollbar {
          display: none;
        }

        .navdash-mobile-view #bc-v2-topbar .bc2-clock {
          font-size: 8px !important;
        }

        .navdash-mobile-view header {
          padding: 4px !important;
        }

        .navdash-mobile-view header > div {
          align-items: stretch !important;
        }

        .navdash-mobile-view header .flex.flex-wrap {
          width: 100% !important;
          display: grid !important;
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          gap: 4px !important;
        }

        .navdash-mobile-view header button,
        .navdash-mobile-view header label {
          min-width: 0 !important;
          width: 100% !important;
          height: 34px !important;
          font-size: 9px !important;
        }

        .navdash-mobile-view .navdash-current-console > div.mt-\[5px\] {
          grid-template-columns: minmax(0, 1fr) !important;
          gap: 4px !important;
        }

        .navdash-mobile-view #v12-section-chart {
          min-height: 0 !important;
        }

        .navdash-mobile-view #v12-map {
          height: 46vh !important;
          min-height: 330px !important;
          max-height: 520px !important;
        }

        .navdash-mobile-view #bc-chart-tools {
          left: 5px !important;
          right: 5px !important;
          top: 5px !important;
          max-width: calc(100% - 10px) !important;
          overflow-x: auto !important;
          white-space: nowrap !important;
          scrollbar-width: none;
        }

        .navdash-mobile-view #bc-chart-tools::-webkit-scrollbar {
          display: none;
        }

        .navdash-mobile-view #bc-chart-tools button {
          flex: 0 0 auto !important;
          height: 30px !important;
          padding-left: 9px !important;
          padding-right: 9px !important;
          font-size: 8px !important;
        }

        .navdash-mobile-view aside {
          min-width: 0 !important;
        }

        .navdash-mobile-view #bc-v2-instruments {
          min-height: 0 !important;
          height: auto !important;
        }

        .navdash-mobile-view #bc-v2-instruments .bc2-rail-title,
        .navdash-mobile-view #bc-v2-instruments .bc2-pos,
        .navdash-mobile-view #bc-v2-instruments .bc2-leg {
          padding: 10px !important;
        }

        .navdash-mobile-view #bc2-lat,
        .navdash-mobile-view #bc2-lon {
          font-size: 18px !important;
          line-height: 1.18 !important;
        }

        .navdash-mobile-view #bc-v2-instruments .bc2-big-grid,
        .navdash-mobile-view #bc-v2-instruments .bc2-small-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        }

        .navdash-mobile-view #bc-v2-instruments .bc2-big-grid > div,
        .navdash-mobile-view #bc-v2-instruments .bc2-small-grid > div {
          padding: 9px !important;
          min-width: 0 !important;
        }

        .navdash-mobile-view #bc-v2-instruments strong {
          overflow-wrap: anywhere;
        }

        .navdash-mobile-view #bc2-leg {
          font-size: 20px !important;
        }

        .navdash-mobile-bottom {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 5000;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          height: 58px;
          border-top: 1px solid rgba(201, 162, 39, .35);
          background: rgba(4, 8, 12, .97);
          backdrop-filter: blur(8px);
        }

        html[data-navdash-theme="day"] .navdash-mobile-bottom {
          border-top-color: rgba(148, 112, 0, .3);
          background: rgba(255, 255, 255, .97);
        }

        .navdash-mobile-bottom a,
        .navdash-mobile-bottom button {
          display: flex;
          align-items: center;
          justify-content: center;
          border: 0;
          border-right: 1px solid rgba(148, 163, 184, .16);
          background: transparent;
          color: #c9a227;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: .08em;
          text-transform: uppercase;
        }

        html[data-navdash-theme="day"] .navdash-mobile-bottom a,
        html[data-navdash-theme="day"] .navdash-mobile-bottom button {
          color: #765d00;
        }

        @media (orientation: landscape) and (max-height: 540px) {
          .navdash-mobile-view .navdash-current-console > div.mt-\[5px\] {
            grid-template-columns: minmax(0, 1.25fr) minmax(290px, .75fr) !important;
          }

          .navdash-mobile-view #v12-map {
            height: calc(100vh - 165px) !important;
            min-height: 300px !important;
          }

          .navdash-mobile-view #bc-v2-instruments {
            max-height: calc(100vh - 165px) !important;
            overflow-y: auto !important;
          }
        }
      `}</style>

      <NavDashConsole />
      <MainMapAisTargets />

      <nav className="navdash-mobile-bottom" aria-label="Mobile NavDash navigation">
        <Link href="/mobile">NAV</Link>
        <Link href="/wx">WX</Link>
        <Link href="/msi">MSI</Link>
        <button type="button" onClick={requestDesktopBridgeView}>FULL VIEW</button>
      </nav>
    </div>
  );
}
