import type { ReactNode } from "react";
import AiWeatherBrief from "../../components/AiWeatherBrief";

export default function WxLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <AiWeatherBrief />
    </>
  );
}
