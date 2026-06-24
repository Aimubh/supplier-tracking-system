import { StepRouter } from "@/components/step-router";
import { TabGuard } from "@/components/tab-guard";

export default function OnWorkingPage() {
  return (
    <TabGuard tab="on-working">
      <main className="px-7 py-6">
        <StepRouter tab="on-working" />
      </main>
    </TabGuard>
  );
}
