import type { ReactNode } from "react";
import { BridgeConsoleRouteGate } from "../../components/BridgeConsoleRouteGate";

export default function MobileLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <BridgeConsoleRouteGate />
    </>
  );
}
