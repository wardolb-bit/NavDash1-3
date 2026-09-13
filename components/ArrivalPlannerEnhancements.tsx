"use client";

import { useEffect } from "react";

export function ArrivalPlannerEnhancements() {
  useEffect(() => {
    let printStyle: HTMLStyleElement | null = null;
    let printSection: HTMLElement | null = null;

    function cleanupPrint() {
      printSection?.classList.remove("navdash-arrival-print-target");
      printStyle?.remove();
      printStyle = null;
      printSection = null;
      window.removeEventListener("afterprint", cleanupPrint);
    }

    function printPlan() {
      const table = document.querySelector("table");
      const section = table?.closest("section") as HTMLElement | null;
      if (!section) return;

      cleanupPrint();
      printSection = section;
      section.classList.add("navdash-arrival-print-target");
      printStyle = document.createElement("style");
      printStyle.textContent = `
        @media print {
          @page { size: landscape; margin: 0.35in; }
          html, body { background: #fff !important; }
          body * { visibility: hidden !important; }
          .navdash-arrival-print-target,
          .navdash-arrival-print-target * { visibility: visible !important; }
          .navdash-arrival-print-target {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            border: 0 !important;
            background: #fff !important;
            color: #111 !important;
          }
          .navdash-arrival-print-target .overflow-x-auto { overflow: visible !important; }
          .navdash-arrival-print-target table {
            width: 100% !important;
            min-width: 0 !important;
            table-layout: auto !important;
            color: #111 !important;
            font-size: 9pt !important;
          }
          .navdash-arrival-print-target th,
          .navdash-arrival-print-target td {
            color: #111 !important;
            border-color: #bbb !important;
            padding: 5px 6px !important;
          }
          .navdash-arrival-print-target input {
            border: 0 !important;
            background: transparent !important;
            color: #111 !important;
            padding: 0 !important;
            width: 48px !important;
            font: inherit !important;
          }
        }
      `;
      document.head.appendChild(printStyle);
      window.addEventListener("afterprint", cleanupPrint);
      window.print();
    }

    function install() {
      const title = Array.from(document.querySelectorAll("h1")).find((node) => node.textContent?.includes("Voyage Timing Planner"));
      if (title) title.textContent = "Arrival Planner";

      if (document.getElementById("navdash-arrival-print")) return Boolean(title);
      const actions = document.querySelector("main header .flex.flex-wrap.gap-2");
      if (!actions) return false;

      const button = document.createElement("button");
      button.id = "navdash-arrival-print";
      button.type = "button";
      button.textContent = "Print Plan";
      button.className = "border border-[#c9a227]/70 px-3 py-2 text-[10px] font-black uppercase text-[#c9a227]";
      button.addEventListener("click", printPlan);
      actions.insertBefore(button, actions.lastElementChild);
      return true;
    }

    if (!install()) {
      const timer = window.setInterval(() => {
        if (install()) window.clearInterval(timer);
      }, 100);
      return () => {
        window.clearInterval(timer);
        document.getElementById("navdash-arrival-print")?.remove();
        cleanupPrint();
      };
    }

    return () => {
      document.getElementById("navdash-arrival-print")?.remove();
      cleanupPrint();
    };
  }, []);

  return null;
}
