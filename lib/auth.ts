import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

/** Credentials used only when nothing is configured and we are not in production. */
const DEV_FALLBACK = { email: "user", password: "user" };

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
        const demoHash = process.env.DEMO_USER_PASSWORD_HASH;

        // Nothing configured: fall back to user/user so a fresh clone can log in
        // with `npm run dev` alone. Deliberately dev-only — a build running in
        // production must state its credentials explicitly rather than inherit a
        // password that is published in this repository.
        if (!demoEmail || !demoHash) {
          if (process.env.NODE_ENV === "production") {
            throw new Error(
              "DEMO_USER_EMAIL / DEMO_USER_PASSWORD_HASH belum diset di environment"
            );
          }
          if (email !== DEV_FALLBACK.email || password !== DEV_FALLBACK.password) {
            return null;
          }
          return { id: "demo-user", email: DEV_FALLBACK.email, name: "Demo User" };
        }

        if (email !== demoEmail) return null;
        if (!(await bcrypt.compare(password, demoHash))) return null;

        return { id: "demo-user", email: demoEmail, name: "Demo User" };
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
