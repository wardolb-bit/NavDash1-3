"use client";

import { useEffect } from "react";

const MAP_ELEMENT_ID = "navmap-main-isolated-v2";

export function EncPopupCloseFix() {
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let map: any = null;

    const attachPopupGuards = (event?: any) => {
      if (cancelled || !map) return;
      const popup = event?.popup || map._popup;
      const element = popup?.getElement?.() as HTMLElement | null;
      if (!element || !element.classList.contains("navdash-enc-popup")) return;

      element.style.pointerEvents = "auto";

      const stop = (ev: Event) => {
        ev.stopPropagation();
      };
      element.addEventListener("click", stop);
      element.addEventListener("pointerdown", stop);
      element.addEventListener("touchstart", stop, { passive: true });

      const close = element.querySelector(".leaflet-popup-close-button") as HTMLElement | null;
      if (close && !close.dataset.navdashEncCloseBound) {
        close.dataset.navdashEncCloseBound = "true";
        const closePopup = (ev: Event) => {
          ev.preventDefault();
          ev.stopPropagation();
          try { map.closePopup(popup); } catch {}
        };
        close.addEventListener("click", closePopup);
        close.addEventListener("pointerup", closePopup);
      }
    };

    const attach = () => {
      if (cancelled) return;
      const element = document.getElementById(MAP_ELEMENT_ID) as any;
      map = element?.__navdashLeafletMap;
      if (!map) {
        timer = window.setTimeout(attach, 100);
        return;
      }

      map.on("popupopen", attachPopupGuards);
      attachPopupGuards();
    };

    attach();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      try { if (map) map.off("popupopen", attachPopupGuards); } catch {}
    };
  }, []);

  return null;
}
