import { ArrivalPlannerEnhancements } from "../../components/ArrivalPlannerEnhancements";

export default function VoyagePlannerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ArrivalPlannerEnhancements />
      {children}
    </>
  );
}
