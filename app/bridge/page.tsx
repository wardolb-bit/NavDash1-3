import NavDashConsole from "../NavDashConsole";
import { MainMapAisTargets } from "../../components/MainMapAisTargets";
import { BridgeTrackedAisTargets } from "../../components/BridgeTrackedAisTargets";
import { MobileBridgeRedirect } from "../../components/MobileBridgeRedirect";
import { AisMapReadyRetry } from "../../components/AisMapReadyRetry";
import { EncObjectInfo } from "../../components/EncObjectInfo";
import { ArrivalPlannerBridgeButton } from "../../components/ArrivalPlannerBridgeButton";
import { MapCursorReadout } from "../../components/MapCursorReadout";
import { MapFloatingControlsContext } from "../../components/MapFloatingControlsContext";
import { RouteLegInspector } from "../../components/RouteLegInspector";

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
      <MapCursorReadout />
      <MapFloatingControlsContext />
      <RouteLegInspector />
      <style>{`#navmap-main-isolated-v2,#navmap-main-isolated-v2 .leaflet-container,#navmap-main-isolated-v2 .leaflet-pane,#navmap-main-isolated-v2 .leaflet-interactive{cursor:crosshair!important}#navmap-main-isolated-v2 .leaflet-control,#navmap-main-isolated-v2 .leaflet-control *{cursor:pointer!important}`}</style>
    </>
  );
}
