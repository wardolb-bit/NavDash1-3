import type { ReactNode } from "react";
import AiWeatherBrief from "../../components/AiWeatherBrief";
import "./wx-ui.css";

export default function WxLayout({ children }: { children: ReactNode }) {
  return (
    <div className="wx-modern-ui">
      {children}
      <AiWeatherBrief />
    </div>
  );
}
