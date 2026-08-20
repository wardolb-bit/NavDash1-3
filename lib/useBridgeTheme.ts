"use client";

import { useEffect, useState } from "react";

export type BridgeTheme = "bridge-night" | "day";

const THEME_STORAGE_KEY = "navConsoleTheme";

function readStoredTheme(): BridgeTheme {
  if (typeof window === "undefined") return "bridge-night";

  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);

  return saved === "day" ? "day" : "bridge-night";
}

export function useBridgeTheme() {
  const [theme, setTheme] = useState<BridgeTheme>("bridge-night");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setTheme(readStoredTheme());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded || typeof window === "undefined") return;

    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
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
