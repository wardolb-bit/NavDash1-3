"use client";

import { usePathname } from "next/navigation";
import { BridgeConsolePreview } from "./BridgeConsolePreview";
import { BridgeQuickAccess } from "./BridgeQuickAccess";
import { BridgeOwnShipEnhancer } from "./BridgeOwnShipEnhancer";
import { BridgeRailPolish } from "./BridgeRailPolish";

/**
 * Keep the bridge-console DOM enhancers scoped to the main Nav Console route.
 *
 * These components use timers/observers and direct DOM references. Mounting them
 * in the root layout allowed those references to survive client-side navigation
 * to ECR/Position Report and then fight the newly-mounted main-page DOM on return.
 * Scoping them to `/` guarantees their cleanup runs when leaving Nav Console and
 * gives them fresh DOM references when returning.
 */
export function BridgeConsoleRouteGate() {
  const pathname = usePathname();

  if (pathname !== "/") return null;

  return (
    <>
      <BridgeConsolePreview />
      <BridgeOwnShipEnhancer />
      <BridgeRailPolish />
      <BridgeQuickAccess />
    </>
  );
}
