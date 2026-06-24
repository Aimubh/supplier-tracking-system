import { Inbox } from "lucide-react";
import { Reveal } from "./motion";
import { SpotlightCard } from "./spotlight-card";

// A clean empty placeholder for a tab whose content isn't built yet.
export function EmptyPanel({
  message = "Nothing here yet",
  hint = "This section is empty. We'll build its working area next.",
}: {
  message?: string;
  hint?: string;
}) {
  return (
    <Reveal>
      <SpotlightCard className="flex flex-col items-center justify-center gap-4 px-6 py-24 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface text-ink ring-1 ring-inset ring-line">
          <Inbox className="h-6 w-6" />
        </div>
        <div>
          <h2 className="font-display text-lg font-medium tracking-tight text-ink">
            {message}
          </h2>
          <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">
            {hint}
          </p>
        </div>
      </SpotlightCard>
    </Reveal>
  );
}
