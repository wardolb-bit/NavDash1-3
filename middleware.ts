import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  // This deployment is a separate relief website, not the full NavDash interface.
  // Keep API and static asset paths available for its original pages.
  const allowed = pathname === "/" || pathname === "/bridge" ||
    pathname === "/position-report" || pathname === "/route-weather-lab" ||
    pathname.startsWith("/api/") || pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" || pathname.startsWith("/public/") ||
    /\.[a-z0-9]{2,6}$/i.test(pathname);
  if (!allowed) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/).*)"] };
