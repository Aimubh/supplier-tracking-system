import { StepRouter } from "@/components/step-router";
import { TabGuard } from "@/components/tab-guard";

export default function PostOrderPage() {
  return (
    <TabGuard tab="post-order">
      <main className="px-7 py-6">
        <StepRouter tab="post-order" />
      </main>
    </TabGuard>
  );
}
