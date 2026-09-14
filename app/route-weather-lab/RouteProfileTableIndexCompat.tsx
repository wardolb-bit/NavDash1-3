"use client";

import { useEffect } from "react";

export default function RouteProfileTableIndexCompat() {
  useEffect(() => {
    let raf = 0;

    const apply = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>("table tbody tr"));
        rows.forEach((row) => {
          if (row.querySelector('td[data-route-profile-index-pad="1"]')) return;
          const cells = row.querySelectorAll<HTMLTableCellElement>("td");
          if (cells.length !== 8 || !cells[2]) return;
          const pad = document.createElement("td");
          pad.dataset.routeProfileIndexPad = "1";
          pad.style.display = "none";
          pad.setAttribute("aria-hidden", "true");
          row.insertBefore(pad, cells[2]);
        });
      });
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.querySelectorAll('td[data-route-profile-index-pad="1"]').forEach((cell) => cell.remove());
    };
  }, []);

  return null;
}
