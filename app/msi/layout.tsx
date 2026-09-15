import type { ReactNode } from "react";
import { MsiConsoleSkin } from "../../components/MsiConsoleSkin";

export default function MsiLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <MsiConsoleSkin />
    </>
  );
}
