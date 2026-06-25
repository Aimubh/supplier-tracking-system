// Augment NextAuth's Session/JWT with our role + tab-access fields.
import type { Role, TabKey } from "@/lib/access";
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      role: Role;
      access: TabKey[];
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid: string;
    role: Role;
    access: TabKey[];
  }
}
