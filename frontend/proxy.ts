import { type NextRequest, NextResponse } from "next/server";

// Public paths that don't require authentication
const PUBLIC_PATHS = ["/", "/login"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow Next.js internals and API routes
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/api/")
  ) {
    return NextResponse.next();
  }

  const session = request.cookies.get("ap_session");

  // Logged-in users hitting the landing or login page go straight to dashboard
  if ((pathname === "/" || pathname === "/login") && session) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Public paths allowed without a session
  if (PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  // Gate all other routes
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
