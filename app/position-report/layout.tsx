import Link from 'next/link';
import type { ReactNode } from 'react';
import './position-report.css';

export default function PositionReportLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Link
        href="/"
        aria-label="Return to Nav Console"
        className="position-report-nav-console"
      >
        NAV CONSOLE
      </Link>
      {children}
    </>
  );
}
