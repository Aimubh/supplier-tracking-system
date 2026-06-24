import { Lock } from "lucide-react";
import { CURRENT_USER, canAccess, type TabKey } from "@/lib/access";

// Renders children only if the current user may access the tab.
// UI-only gate for now; real enforcement lands with server-side auth + middleware.
export function TabGuard({
  tab,
  children,
}: {
  tab: TabKey;
  children: React.ReactNode;
}) {
  if (canAccess(CURRENT_USER, tab)) return <>{children}</>;

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
