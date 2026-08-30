import type { ReactNode } from "react";
import MoonPhaseDock from "../../components/MoonPhaseDock";
import CelestialConstellationEnhancer from "../../components/CelestialConstellationEnhancer";

export default function CelestialLayout({children}:{children:ReactNode}){
  return <>
    {children}
    <MoonPhaseDock />
    <CelestialConstellationEnhancer />
  </>;
}
