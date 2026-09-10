import CrewViewPage from "./phone/page";
import { CrewRootRouteAdapter } from "../components/CrewRootRouteAdapter";

export default function HomePage() {
  return (
    <CrewRootRouteAdapter>
      <CrewViewPage />
    </CrewRootRouteAdapter>
  );
}
