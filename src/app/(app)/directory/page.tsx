import { TabGuard } from "@/components/tab-guard";
import { DirectoryView } from "@/components/directory-view";

export default function DirectoryPage() {
  return (
    <TabGuard tab="directory">
      <DirectoryView />
    </TabGuard>
  );
}
