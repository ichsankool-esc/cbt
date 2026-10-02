import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { username: {}, password: {} },
      authorize: async (creds) => {
        if (!creds?.username || !creds?.password) return null;

        const user = await db.users.findFirst({
          where: { username: String(creds.username), deleted_at: null },
        });

        if (!user || user.status !== "active") return null;

        const ok = await bcrypt.compare(
          String(creds.password),
          user.password_hash
        );
        if (!ok) return null;

        return {
          id: user.id,
          name: user.full_name,
          role: user.role,
          schoolId: user.school_id ?? null,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = (user as any).id;
        token.role = (user as any).role;
        token.schoolId = (user as any).schoolId;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid as string;
        session.user.role = token.role as string;
        session.user.schoolId = (token.schoolId as string) ?? null;
      }
      return session;
    },
  },
});
