import "./tools-current.css";
import ToolsMainButton from "./ToolsMainButton";

export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="navdash-tools-current">
      {children}
      <ToolsMainButton />
    </div>
  );
}
