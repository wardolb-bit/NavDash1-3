import NavDashConsole from "../NavDashConsole";
import { MainMapAisTargets } from "../../components/MainMapAisTargets";
import { BridgeTrackedAisTargets } from "../../components/BridgeTrackedAisTargets";
import { MobileBridgeRedirect } from "../../components/MobileBridgeRedirect";
import { AisMapReadyRetry } from "../../components/AisMapReadyRetry";
import { EncObjectInfo } from "../../components/EncObjectInfo";
import { EncPopupCloseFix } from "../../components/EncPopupCloseFix";
import { ArrivalPlannerBridgeButton } from "../../components/ArrivalPlannerBridgeButton";
import { MapCursorReadout } from "../../components/MapCursorReadout";
import { MapFloatingControlsContext } from "../../components/MapFloatingControlsContext";

export default function BridgePage() {
  return (
    <>
      <MobileBridgeRedirect />
      <NavDashConsole />
      <ArrivalPlannerBridgeButton />
      <MainMapAisTargets />
      <BridgeTrackedAisTargets />
      <AisMapReadyRetry />
      <EncObjectInfo />
      <EncPopupCloseFix />
      <MapCursorReadout />
      <MapFloatingControlsContext />
    </>
  );
}
