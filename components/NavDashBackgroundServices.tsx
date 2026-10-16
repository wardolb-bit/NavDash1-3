"use client";

import { usePathname } from 'next/navigation';
import { SharedAisConnection } from './SharedAisConnection';
import { SharedRouteSync } from './SharedRouteSync';
import { SharedAmiForecastSync } from './SharedAmiForecastSync';

export function NavDashBackgroundServices() {
  const path = usePathname();
  if (path === '/network' || path.startsWith('/network/')) return null;
  return <><SharedAisConnection /><SharedRouteSync /><SharedAmiForecastSync /></>;
}
