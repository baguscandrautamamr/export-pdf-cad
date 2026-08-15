import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Page guard.
 *
 * This does not use next-auth's stock withAuth, because that leaves the app at
 * the mercy of how NEXTAUTH_URL happens to be spelled. NextAuth's route handler
 * runs the value through parseUrl(), which prepends "https://" when it is
 * missing, and then picks cookie names from the result. getToken() instead
 * tests `NEXTAUTH_URL.startsWith("https://")` literally. So NEXTAUTH_URL set to
 * "example.com" rather than "https://example.com" makes the handler write
 * __Secure-next-auth.session-token while the middleware looks for
 * next-auth.session-token — sign-in succeeds, /api/auth/session reports a valid
 * session, and every page still bounces back to /login.
 *
 * Reading both names removes the dependency entirely: whichever one the handler
 * chose, the guard finds it.
 */
const SECRET = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;

export async function middleware(req: NextRequest) {
  const token =
    (await getToken({ req, secret: SECRET, secureCookie: true })) ??
    (await getToken({ req, secret: SECRET, secureCookie: false }));

  if (token) return NextResponse.next();

  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  login.searchParams.set("callbackUrl", `${req.nextUrl.pathname}${req.nextUrl.search}`);
  return NextResponse.redirect(login);
}

// /api/* is deliberately excluded: each API route checks the session itself so
// an unauthenticated fetch gets a JSON 401 instead of an HTML redirect.
export const config = {
  matcher: [
    "/((?!api|login|_next|manifest.json|sw.js|icons|favicon.ico|icon.png).*)",
  ],
};
