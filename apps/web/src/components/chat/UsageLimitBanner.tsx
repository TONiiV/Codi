import type { OrchestrationSession } from "@t3tools/contracts";
import {
  describeUsageLimitPause,
  usageLimitTickIntervalMs,
} from "@t3tools/client-runtime/state/usage-limit";
import { HourglassIcon } from "lucide-react";
import { memo, useEffect, useState } from "react";

import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";

/**
 * Keeps the countdown honest without repainting on a frame timer: the tick
 * matches the coarsest unit on screen, so an hours-away reset costs one
 * re-render an hour and a due one costs none at all.
 */
function useUsageLimitPause(usageLimit: OrchestrationSession["usageLimit"]) {
  const [now, setNow] = useState(() => new Date().toISOString());
  const view = describeUsageLimitPause(usageLimit, { now });
  const intervalMs = usageLimitTickIntervalMs(view);

  useEffect(() => {
    if (intervalMs === null) {
      return;
    }
    const timer = setInterval(() => setNow(new Date().toISOString()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return view;
}

/**
 * The thread's side of a provider usage limit: what stopped, when it comes
 * back, and both ways out — resume early, or drop the pending resume.
 */
export const UsageLimitBanner = memo(function UsageLimitBanner({
  usageLimit,
  autoResumeEnabled,
  onResumeNow,
  onDismiss,
}: {
  usageLimit: OrchestrationSession["usageLimit"];
  autoResumeEnabled: boolean;
  onResumeNow: () => void;
  onDismiss: () => void;
}) {
  const pause = useUsageLimitPause(usageLimit);
  if (pause === null) {
    return null;
  }

  const description = pause.isDue
    ? autoResumeEnabled
      ? `Usage limit reached. The limit has reset — resuming now.`
      : `Usage limit reached. The limit reset at ${pause.clockLabel}.`
    : autoResumeEnabled
      ? `Usage limit reached. Resuming in ${pause.countdown}, at ${pause.clockLabel}.`
      : `Usage limit reached. The limit resets in ${pause.countdown}, at ${pause.clockLabel}. Auto-resume is off.`;

  return (
    <div className="mx-auto w-fit max-w-[min(48rem,calc(100%-2rem))] pt-3">
      <Alert variant="warning" controlAlignment="first-line">
        <HourglassIcon />
        <AlertDescription>{description}</AlertDescription>
        <AlertAction>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="xs" onClick={onResumeNow}>
              Resume now
            </Button>
            <Button variant="ghost" size="xs" onClick={onDismiss}>
              Cancel
            </Button>
          </div>
        </AlertAction>
      </Alert>
    </div>
  );
});
