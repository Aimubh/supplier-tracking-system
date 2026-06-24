import { redirect } from "next/navigation";

// The early kanban prototype lived here. It predates the current SaaS design and
// the finalized tab structure, so it now redirects to the dashboard. Kept as a
// route in case we revive a board view later.
export default function PipelineRedirect() {
  redirect("/dashboard");
}
