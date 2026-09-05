"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type NavItem = { label: string; href: string };
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  { label: "Console", items: [{ label: "Main Console", href: "/" }, { label: "Tides", href: "/tides" }, { label: "ECR", href: "/ecr" }] },
  { label: "AIS", items: [{ label: "AIS Targets", href: "/ais-test" }] },
  { label: "Weather", items: [{ label: "Weather", href: "/wx" }, { label: "WX Routing", href: "/wx-routing" }, { label: "Official Weather", href: "/official-weather" }] },
  { label: "MSI", items: [{ label: "EGC / MSI", href: "/msi" }] },
  { label: "Reports", items: [{ label: "Position Report", href: "/position-report" }, { label: "Nav Brief", href: "/nav-brief" }] },
  { label: "Tools", items: [{ label: "Watch Tools", href: "/tools" }] },
  { label: "Mobile", items: [{ label: "Phone View", href: "/phone" }] },
];

function itemIsActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavDashNav() {
  const pathname = usePathname();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const celestialActive = pathname.startsWith("/celestial");
  const activeGroup = celestialActive
    ? { label: "Celestial", items: [] }
    : navGroups.find((group) => group.items.some((item) => itemIsActive(pathname, item.href))) || navGroups[0];

  return (
    <nav className="navdash-global-nav">
      <div className="navdash-global-shell">
        <div className="navdash-global-topbar">
          <Link href="/" className="navdash-global-brand">
            <span className="navdash-global-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 15c2.2 0 2.2-1.6 4.4-1.6S9.6 15 11.8 15s2.2-1.6 4.4-1.6S18.4 15 20.6 15"/><path d="M5 10.5c1.7 0 1.7-1.3 3.4-1.3s1.7 1.3 3.4 1.3 1.7-1.3 3.4-1.3 1.7 1.3 3.4 1.3"/></svg>
            </span>
            <span className="navdash-global-brand-copy">
              <strong>NAVDASH</strong>
              <small>MARINER&apos;S BRIDGE CONSOLE · {activeGroup.label.toUpperCase()}</small>
            </span>
          </Link>

          <div className="navdash-global-clock" aria-label="Current UTC time">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
            <span><strong>{now ? `${now.toLocaleTimeString("en-US", { timeZone: "UTC", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}Z` : "--:--:--Z"}</strong><small>{now ? now.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short", year: "numeric" }).toUpperCase() : "UTC"}</small></span>
          </div>

          <select
            className="navdash-global-select"
            value={celestialActive ? "/celestial" : pathname}
            onChange={(event) => { window.location.href = event.target.value; }}
            aria-label="NavDash page"
          >
            {navGroups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.items.map((item) => <option key={item.href} value={item.href}>{item.label}</option>)}
              </optgroup>
            ))}
            <optgroup label="Celestial"><option value="/celestial">Star Finder</option></optgroup>
          </select>
        </div>

        <div className="navdash-global-links">
          <Link
            href="/celestial"
            className={`navdash-global-star ${celestialActive ? "is-active" : ""}`}
          >
            ✦ Star Finder
          </Link>

          <div className="navdash-global-scroll">
            <div className="navdash-global-groups">
              {navGroups.map((group) => {
                const groupActive = group.items.some((item) => itemIsActive(pathname, item.href));
                return (
                  <div key={group.label} className={`navdash-global-group ${groupActive ? "is-active" : ""}`}>
                    <span>{group.label}</span>
                    {group.items.map((item) => {
                      const active = itemIsActive(pathname, item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={active ? "is-active" : ""}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
