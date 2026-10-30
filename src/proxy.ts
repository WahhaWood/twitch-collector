import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Cheap gate: presence only. Signature and user are verified in getCurrentUser().
export function proxy(req: NextRequest) {
  if (req.cookies.has("session")) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    return Response.json({ error: { code: "unauthorized", message: "Login required" } }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/", req.url));
}

export const config = {
  matcher: ["/accounts/:path*", "/catalog/:path*", "/stats/:path*", "/admin/:path*", "/help/:path*", "/streaks/:path*", "/api/((?!auth/login|auth/logout|internal/).*)"],
};
