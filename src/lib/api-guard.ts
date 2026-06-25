// Server-side access enforcement for API routes.
//
// The middleware only confirms a caller is signed in. These helpers add the
// per-role / per-tab checks the app-logic skill requires to be server-side, so a
// signed-in employee can't reach data for a tab they weren't granted just by
// calling the API directly (bypassing the UI's TabGuard).
//
// Usage in a route handler:
//   const denied = await requireTabAccess(PRODUCT_TABS);
//   if (denied) return denied;            // 401/403 NextResponse, already formed
//   ... proceed ...

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccess, type AppUser, type Role, type TabKey } from "@/lib/access";

// Tabs whose data lives in the Product model. A caller needs at least one of
// these to read/write products. (Dashboard is read-only overview; the editing
// tabs are what actually mutate.)
export const PRODUCT_TABS: TabKey[] = [
  "dashboard",
  "pre-order",
  "on-working",
  "post-order",
  "order-summary",
];

// Tabs whose data lives in the Manufacturer model.
export const MANUFACTURER_TABS: TabKey[] = ["directory"];

const FORBIDDEN = NextResponse.json({ error: "Forbidden" }, { status: 403 });
const UNAUTHORIZED = NextResponse.json({ error: "Unauthorized" }, { status: 401 });

// Resolve the signed-in user from the session (or null if not signed in).
export async function getSessionUser(): Promise<AppUser | null> {
  const session = await getServerSession(authOptions);
  const u = session?.user;
  if (!u?.email) return null;
  return {
    id: (u.id as string) ?? "",
    name: u.name ?? "",
    email: u.email,
    role: (u.role as Role) ?? "EMPLOYEE",
    access: (u.access as TabKey[]) ?? [],
    active: true,
  };
}

// Returns a NextResponse to send back if the caller is NOT allowed, or null if
// they may proceed. ADMIN always passes (canAccess handles that).
export async function requireTabAccess(tabs: TabKey[]): Promise<NextResponse | null> {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED;
  const allowed = tabs.some((tab) => canAccess(user, tab));
  return allowed ? null : FORBIDDEN;
}

// Admin-only guard (used by the users API).
export async function requireAdmin(): Promise<NextResponse | null> {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED;
  return user.role === "ADMIN" ? null : FORBIDDEN;
}
