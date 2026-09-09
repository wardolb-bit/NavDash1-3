"use client";

import { useEffect, useState } from "react";

export type BridgeTheme = "bridge-night" | "day";

const THEME_STORAGE_KEY = "navConsoleTheme";
const THEME_ATTRIBUTE = "data-navdash-theme";
const THEME_EVENT = "navdash-theme-change";

function readStoredTheme(): BridgeTheme {
  if (typeof window === "undefined") return "bridge-night";

  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);

  return saved === "day" ? "day" : "bridge-night";
}

function publishTheme(theme: BridgeTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
  document.body?.setAttribute(THEME_ATTRIBUTE, theme);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<BridgeTheme>(THEME_EVENT, { detail: theme }));
  }
}

export function useBridgeTheme() {
  const [theme, setTheme] = useState<BridgeTheme>("bridge-night");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const storedTheme = readStoredTheme();
    setTheme(storedTheme);
    publishTheme(storedTheme);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleThemeChange = (event: Event) => {
      const next = (event as CustomEvent<BridgeTheme>).detail;
      if (next === "day" || next === "bridge-night") {
        setTheme((current) => (current === next ? current : next));
      }
    };

    window.addEventListener(THEME_EVENT, handleThemeChange);
    return () => window.removeEventListener(THEME_EVENT, handleThemeChange);
  }, []);

  useEffect(() => {
    if (!loaded || typeof window === "undefined") return;

    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    publishTheme(theme);
  }, [loaded, theme]);

  function toggleTheme() {
    setTheme((current) =>
      current === "bridge-night" ? "day" : "bridge-night"
    );
  }

  return {
    theme,
    nightMode: theme === "bridge-night",
    dayMode: theme === "day",
    toggleTheme,
    setTheme,
  };
}
