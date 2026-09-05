"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { label: string; href: string };
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  { label: "Console", items: [{ label: "Main Console", href: "/" }, { label: "ECR", href: "/ecr" }] },
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
  if (pathname.startsWith("/tides")) return null;

  const celestialActive = pathname.startsWith("/celestial");
  const activeGroup = celestialActive
    ? { label: "Celestial", items: [] }
    : navGroups.find((group) => group.items.some((item) => itemIsActive(pathname, item.href))) || navGroups[0];

  return (
    <nav className="navdash-global-nav sticky top-0 z-[1000] border-b border-white/10 bg-[#06111f]/95 text-slate-100 shadow-xl shadow-black/30 backdrop-blur-xl">
      <div className="mx-auto flex max-w-none flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-[#f2b84b]/45 bg-[#f2b84b]/15 text-lg font-black text-[#f2b84b]">ND</span>
            <span className="min-w-0">
              <span className="block text-sm font-black uppercase text-[#f2b84b]">NavDash 1.3</span>
              <span className="block truncate text-xs font-bold uppercase tracking-[0.16em] text-slate-400">{activeGroup.label}</span>
            </span>
          </Link>

          <select
            className="max-w-[13rem] rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm font-bold text-slate-100 outline-none lg:hidden"
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

        <div className="hidden min-w-0 flex-1 items-center justify-end gap-2 lg:flex">
          <Link
            href="/celestial"
            className={`inline-flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-2xl border px-4 text-sm font-black shadow-lg transition ${celestialActive ? "border-[#f2b84b] bg-[#f2b84b] text-slate-950 shadow-[#f2b84b]/20" : "border-[#f2b84b]/45 bg-[#f2b84b]/15 text-[#f0c46a] hover:bg-[#f2b84b]/25"}`}
          >
            ✦ Star Finder
          </Link>

          <div className="min-w-0 overflow-x-auto">
            <div className="flex w-max flex-nowrap items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.055] p-1.5">
              {navGroups.map((group) => {
                const groupActive = group.items.some((item) => itemIsActive(pathname, item.href));
                return (
                  <div key={group.label} className={`flex shrink-0 items-center gap-1 rounded-xl px-1.5 py-1 ${groupActive ? "bg-[#f2b84b]/10" : ""}`}>
                    <span className="whitespace-nowrap px-2 text-xs font-black uppercase tracking-[0.12em] text-slate-400">{group.label}</span>
                    {group.items.map((item) => {
                      const active = itemIsActive(pathname, item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`whitespace-nowrap rounded-xl px-3 py-2 text-sm font-black transition ${active ? "bg-[#f2b84b] text-slate-950 shadow-md shadow-[#f2b84b]/20" : "text-slate-200 hover:bg-white/10"}`}
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
