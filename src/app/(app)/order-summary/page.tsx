import { TabGuard } from "@/components/tab-guard";
import { OrderSummaryView } from "@/components/order-summary-view";

export default function OrderSummaryPage() {
  return (
    <TabGuard tab="order-summary">
      <OrderSummaryView />
    </TabGuard>
  );
}
