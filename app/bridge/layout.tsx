import type { ReactNode } from "react";
import { BridgeConsoleRouteGate } from "../../components/BridgeConsoleRouteGate";
import { EncInfoContextMenuBridge } from "../../components/EncInfoContextMenuBridge";

export default function BridgeLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <BridgeConsoleRouteGate />
      <EncInfoContextMenuBridge />
    </>
  );
}
