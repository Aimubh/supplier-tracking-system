import { TabGuard } from "@/components/tab-guard";
import { DashboardView } from "@/components/dashboard-view";

export default function DashboardPage() {
  return (
    <TabGuard tab="dashboard">
      <DashboardView />
    </TabGuard>
  );
}
