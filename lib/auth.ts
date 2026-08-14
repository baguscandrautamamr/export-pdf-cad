import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

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
        if (!demoEmail || !demoHash) {
          throw new Error(
            "DEMO_USER_EMAIL / DEMO_USER_PASSWORD_HASH belum diset di environment"
          );
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
