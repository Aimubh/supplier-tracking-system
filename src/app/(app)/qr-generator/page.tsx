import { TabGuard } from "@/components/tab-guard";
import { QrGeneratorView } from "@/components/qr-generator-view";

export default function QrGeneratorPage() {
  return (
    <TabGuard tab="qr-generator">
      <QrGeneratorView />
    </TabGuard>
  );
}
