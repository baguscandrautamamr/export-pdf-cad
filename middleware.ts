import { withAuth } from "next-auth/middleware";

// pages.signIn is repeated here because middleware runs in the edge runtime and
// never sees authOptions; without it, unauthenticated users take an extra hop
// through the default /api/auth/signin page.
export default withAuth({ pages: { signIn: "/login" } });

// /api/* is deliberately excluded: each API route checks the session itself so
// an unauthenticated fetch gets a JSON 401 instead of an HTML redirect.
export const config = {
  matcher: [
    "/((?!api|login|_next|manifest.json|sw.js|icons|favicon.ico|icon.png).*)",
  ],
};
