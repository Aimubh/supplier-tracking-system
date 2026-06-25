"use client";

import { Lock } from "lucide-react";
import { canAccess, type TabKey } from "@/lib/access";
import { useCurrentUser } from "@/lib/use-current-user";

// Renders children only if the signed-in user may access the tab. This is the UI
// guard; the API routes enforce the same access server-side.
export function TabGuard({
  tab,
  children,
}: {
  tab: TabKey;
  children: React.ReactNode;
}) {
  const user = useCurrentUser();
  if (!user) return null; // session loading
  if (canAccess(user, tab)) return <>{children}</>;

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-20">
      <div className="glass flex max-w-sm flex-col items-center gap-3 rounded-lg px-6 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-block/10 text-block ring-1 ring-inset ring-block/20">
          <Lock className="h-6 w-6" />
        </div>
        <h2 className="mt-1 font-display text-lg font-medium tracking-tight text-ink">
          No access to this section
        </h2>
        <p className="text-[13px] leading-relaxed text-muted">
          Your account isn&apos;t authorised for this section. Ask an admin to grant
          access.
        </p>
      </div>
    </main>
  );
}
