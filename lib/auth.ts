import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { createHash, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

/** Constant-time compare for the plaintext password path. */
function timingSafeEqual(a: string, b: string): boolean {
  // Compare digests rather than the strings: equal-length buffers, so neither
  // the password's content nor its length leaks through timing.
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return nodeTimingSafeEqual(da, db);
}

/**
 * Built-in demo account, accepted only outside production.
 *
 * It stays available even when DEMO_USER_* *are* configured, so a stale or
 * mistyped .env.local can never lock you out of your own dev server — the most
 * common way to get locked out is DEMO_USER_PASSWORD_HASH silently arriving
 * empty, because Next runs .env.local through dotenv-expand and an unescaped
 * '$' in a bcrypt hash reads as a variable reference.
 *
 * NODE_ENV is set to "production" by `next build`/`next start` and by every
 * real deployment, where this account is refused outright — a password printed
 * in a public repository must never authenticate anything that is deployed.
 */
const DEV_ACCOUNT = { email: "user", password: "user" };
const isProduction = () => process.env.NODE_ENV === "production";

/**
 * Demo single-user auth: the one account lives in env vars.
 *
 * For production multi-user, replace the body of authorize() with a real
 * database lookup — the rest of the app only relies on the returned user
 * object, so nothing else has to change:
 *
 *   const user = await prisma.user.findUnique({ where: { email } });
 *   if (!user) return null;
 *   if (!(await bcrypt.compare(password, user.passwordHash))) return null;
 *   return { id: user.id, email: user.email, name: user.name };
 */
export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password) return null;

        const demoEmail = process.env.DEMO_USER_EMAIL?.trim().toLowerCase();
        const demoHash = process.env.DEMO_USER_PASSWORD_HASH?.trim();
        // Trimmed: pasting a value into a hosting dashboard picks up a trailing
        // newline or space depressingly often, and an untrimmed compare then
        // fails in a way that is indistinguishable from a wrong password.
        const demoPlain = process.env.DEMO_USER_PASSWORD?.trim();
        // A configured hash that is not a bcrypt string is almost always the
        // dotenv-expand trap, not a typo. Treat it as unconfigured and say so.
        const hashUsable = !!demoHash && /^\$2[aby]?\$\d{2}\$/.test(demoHash);

        if (demoHash && !hashUsable) {
          console.error(
            "[auth] DEMO_USER_PASSWORD_HASH bukan hash bcrypt yang valid. " +
              "Di .env.local, tanda $ wajib di-escape jadi \\$ " +
              "(jalankan: npm run check-login)"
          );
        }
        if (!demoEmail || !(hashUsable || demoPlain)) {
          if (isProduction()) {
            throw new Error(
              "DEMO_USER_EMAIL belum diset, atau DEMO_USER_PASSWORD / " +
                "DEMO_USER_PASSWORD_HASH belum diset dengan benar di environment"
            );
          }
        }

        if (demoEmail && email === demoEmail) {
          // A usable hash wins outright. DEMO_USER_PASSWORD is deliberately
          // ignored then, so a weak plaintext value left over in the
          // environment can never sit alongside a strong hash as a second
          // accepted password.
          const ok = hashUsable
            ? await bcrypt.compare(password, demoHash!)
            : !!demoPlain && timingSafeEqual(password, demoPlain);
          if (ok) return { id: "demo-user", email: demoEmail, name: "Demo User" };
        }

        // Built-in dev account, checked after the configured one so a real
        // configuration still wins for its own email.
        if (
          !isProduction() &&
          email === DEV_ACCOUNT.email &&
          password === DEV_ACCOUNT.password
        ) {
          return { id: "demo-user", email: DEV_ACCOUNT.email, name: "Demo User" };
        }

        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.uid) {
        (session.user as { id?: string }).id = token.uid as string;
      }
      return session;
    },
  },
};
