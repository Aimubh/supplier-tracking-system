"use client";

import { useSession } from "next-auth/react";
import type { AppUser } from "@/lib/access";

// The signed-in user, shaped as the app's AppUser. Null while loading or signed
// out. Components that gate on access read from here instead of a hardcoded user.
export function useCurrentUser(): AppUser | null {
  const { data } = useSession();
  const u = data?.user;
  if (!u) return null;
  return {
    id: u.id,
    name: u.name ?? "",
    email: u.email ?? "",
    role: u.role,
    access: u.access ?? [],
    active: true,
  };
}
