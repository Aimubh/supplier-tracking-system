import { Sidebar } from "@/components/sidebar";
import { StoreProvider } from "@/lib/store";

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
