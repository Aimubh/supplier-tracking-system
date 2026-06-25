// NextAuth configuration — email/password against the DB, JWT sessions.
// The session carries the user's role and tab access so the UI and server can
// enforce who-can-see-what (gates enforced server-side, per the app-logic skill).

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import type { TabKey, Role } from "@/lib/access";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
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
        const password = credentials?.password ?? "";
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.active) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        // What we return becomes the JWT payload (see callbacks).
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role as Role,
          access: user.access as TabKey[],
        };
      },
    }),
  ],
  callbacks: {
    // Persist role + access onto the token at sign-in.
    async jwt({ token, user }) {
      if (user) {
        const u = user as unknown as { id: string; role: Role; access: TabKey[] };
        token.uid = u.id;
        token.role = u.role;
        token.access = u.access;
      }
      return token;
    },
    // Expose them on the session object the app reads.
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid as string;
        session.user.role = token.role as Role;
        session.user.access = token.access as TabKey[];
      }
      return session;
    },
  },
};
