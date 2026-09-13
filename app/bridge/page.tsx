import NavDashConsole from "../NavDashConsole";
import { MainMapAisTargets } from "../../components/MainMapAisTargets";
import { MobileBridgeRedirect } from "../../components/MobileBridgeRedirect";
import { AisMapReadyRetry } from "../../components/AisMapReadyRetry";
import { EncObjectInfo } from "../../components/EncObjectInfo";
import { EncChartLayerStabilizer } from "../../components/EncChartLayerStabilizer";

export default function BridgePage() {
  return (
    <>
      <MobileBridgeRedirect />
      <NavDashConsole />
      <MainMapAisTargets />
      <AisMapReadyRetry />
      <EncChartLayerStabilizer />
      <EncObjectInfo />
    </>
  );
}
