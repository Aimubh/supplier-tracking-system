import { Sidebar } from "@/components/sidebar";
import { StoreProvider } from "@/lib/store";

// This whole group is authenticated and data-driven (every page redirects to
// /login when unauthenticated and reads from the API at runtime), so there's no
// value in static prerendering. Forcing dynamic also avoids the build-time
// "useSearchParams() should be wrapped in a suspense boundary" prerender error,
// since the shared <Sidebar /> and several panels read the ?step= query param.
export const dynamic = "force-dynamic";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <StoreProvider>
      <div className="app-bg flex min-h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </StoreProvider>
  );
}
