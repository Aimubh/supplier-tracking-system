import { StepRouter } from "@/components/step-router";
import { TabGuard } from "@/components/tab-guard";

export default function PreOrderPage() {
  return (
    <TabGuard tab="pre-order">
      <main className="px-7 py-6">
        <StepRouter tab="pre-order" />
      </main>
    </TabGuard>
  );
}
