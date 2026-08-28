import type { ReactNode } from "react";
import MoonPhaseDock from "../../components/MoonPhaseDock";

export default function CelestialLayout({children}:{children:ReactNode}){
  return <>
    {children}
    <MoonPhaseDock />
  </>;
}
