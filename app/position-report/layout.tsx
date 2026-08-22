import type { ReactNode } from 'react';
import './position-report.css';
import PositionReportNavConsole from './PositionReportNavConsole';

export default function PositionReportLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PositionReportNavConsole />
      {children}
    </>
  );
}
