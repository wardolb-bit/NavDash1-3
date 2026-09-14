import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const { pathname } = request.nextUrl;

  if (host === "wx.wardlab.dev" && pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/route-weather-lab";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
