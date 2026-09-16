import type { ReactNode } from "react";
import MoonPhaseDock from "../../components/MoonPhaseDock";
import CelestialConstellationEnhancer from "../../components/CelestialConstellationEnhancer";
import { CelestialConsoleSkin } from "../../components/CelestialConsoleSkin";
import { CelestialFinderControlDock } from "../../components/CelestialFinderControlDock";
import { CelestialMainLink } from "../../components/CelestialMainLink";
import { CelestialSunMoon } from "../../components/CelestialSunMoon";

export default function CelestialLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <CelestialConsoleSkin />
      <CelestialSunMoon />
      <MoonPhaseDock />
      <CelestialConstellationEnhancer />
      <CelestialFinderControlDock />
      <CelestialMainLink />
    </>
  );
}
