import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { AREA_ROLES, homeFor } from "@/lib/rbac";

/** Route-level RBAC. API handlers re-check permissions themselves (defence in depth). */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const area = pathname.split("/")[1];
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  const roles = AREA_ROLES[area];
  if (roles) {
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(url);
    }
    if (!roles.includes(session.role)) {
      const url = req.nextUrl.clone();
      url.pathname = homeFor(session.role);
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  const needsLogin = ["/orders", "/profile", "/family", "/checkout", "/repeat"];
  if (!session && needsLogin.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();
  if (pathname.startsWith("/api")) res.headers.set("Cache-Control", "no-store");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons|manifest.webmanifest|rider.webmanifest|sw.js|offline.html).*)"],
};
