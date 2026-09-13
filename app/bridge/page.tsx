import NavDashConsole from "../NavDashConsole";
import { MainMapAisTargets } from "../../components/MainMapAisTargets";
import { MobileBridgeRedirect } from "../../components/MobileBridgeRedirect";
import { AisMapReadyRetry } from "../../components/AisMapReadyRetry";
import { EncObjectInfo } from "../../components/EncObjectInfo";
import { EncPopupCloseFix } from "../../components/EncPopupCloseFix";
import { ArrivalPlannerBridgeButton } from "../../components/ArrivalPlannerBridgeButton";

export default function BridgePage() {
  return (
    <>
      <MobileBridgeRedirect />
      <NavDashConsole />
      <ArrivalPlannerBridgeButton />
      <MainMapAisTargets />
      <AisMapReadyRetry />
      <EncObjectInfo />
      <EncPopupCloseFix />
    </>
  );
}
