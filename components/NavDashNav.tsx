"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  label: string;
  href: string;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    label: "Console",
    items: [
      { label: "Main Console", href: "/" },
      { label: "ECR", href: "/ecr" },
    ],
  },
  {
    label: "AIS",
    items: [{ label: "AIS Targets", href: "/ais-test" }],
  },
  {
    label: "Weather",
    items: [
      { label: "Weather", href: "/wx" },
      { label: "WX Routing", href: "/wx-routing" },
      { label: "Official Weather", href: "/official-weather" },
    ],
  },
  {
    label: "Reports",
    items: [
      { label: "Position Report", href: "/position-report" },
      { label: "Nav Brief", href: "/nav-brief" },
    ],
  },
  {
    label: "Tools",
    items: [{ label: "Watch Tools", href: "/tools" }],
  },
  {
    label: "Mobile",
    items: [{ label: "Phone View", href: "/phone" }],
  },
];

function itemIsActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavDashNav() {
  const pathname = usePathname();
  const activeGroup =
    navGroups.find((group) =>
      group.items.some((item) => itemIsActive(pathname, item.href)),
    ) || navGroups[0];

  return (
    <nav className="sticky top-0 z-[1000] border-b border-slate-700 bg-slate-950 text-slate-100 shadow-lg shadow-black/25">
      <div className="mx-auto flex max-w-none flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center border border-[#c9a227]/50 bg-[#c9a227]/15 text-lg font-black text-[#c9a227]">
              ND
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-black uppercase text-[#c9a227]">
                NavDash 1.3
              </span>
              <span className="block truncate text-xs font-bold uppercase text-slate-400">
                {activeGroup.label}
              </span>
            </span>
          </Link>

          <select
            className="max-w-[13rem] border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-bold text-slate-100 outline-none lg:hidden"
            value={pathname}
            onChange={(event) => {
              window.location.href = event.target.value;
            }}
            aria-label="NavDash page"
          >
            {navGroups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.items.map((item) => (
                  <option key={item.href} value={item.href}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="hidden min-w-0 flex-nowrap items-center gap-1 overflow-x-auto lg:flex">
          {navGroups.map((group) => {
            const groupActive = group.items.some((item) =>
              itemIsActive(pathname, item.href),
            );

            return (
              <div
                key={group.label}
                className={`flex shrink-0 items-center gap-1 border px-2 py-1 ${
                  groupActive
                    ? "border-[#c9a227]/70 bg-[#c9a227]/10"
                    : "border-slate-800 bg-slate-900/60"
                }`}
              >
                <span className="whitespace-nowrap px-2 text-xs font-black uppercase text-slate-400">
                  {group.label}
                </span>
                {group.items.map((item) => {
                  const active = itemIsActive(pathname, item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`whitespace-nowrap px-3 py-2 text-sm font-black ${
                        active
                          ? "bg-[#c9a227] text-slate-950"
                          : "text-slate-200 hover:bg-slate-800"
                      }`}
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
    </nav>
  );
}
