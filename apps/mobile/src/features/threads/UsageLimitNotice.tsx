import type { OrchestrationSession } from "@t3tools/contracts";
import {
  describeUsageLimitPause,
  usageLimitTickIntervalMs,
} from "@t3tools/client-runtime/state/usage-limit";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";

export interface UsageLimitNoticeProps {
  readonly usageLimit: OrchestrationSession["usageLimit"];
  readonly onResumeNow: () => void;
  readonly onDismiss: () => void;
}

/**
 * The thread's side of a provider usage limit: when the window reopens, and
 * both ways out. Deliberately silent about whether the server will resume on
 * its own — mobile does not read server settings, and a promise it cannot
 * verify would be worse than none.
 */
export function UsageLimitNotice(props: UsageLimitNoticeProps) {
  const [now, setNow] = useState(() => new Date().toISOString());
  const pause = describeUsageLimitPause(props.usageLimit, { now });
  const intervalMs = usageLimitTickIntervalMs(pause);

  useEffect(() => {
    if (intervalMs === null) {
      return;
    }
    const timer = setInterval(() => setNow(new Date().toISOString()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  if (pause === null) {
    return null;
  }

  return (
    <View className="gap-2.5 rounded-[20px] border border-adaptive-neutral-200-white-a6 bg-adaptive-neutral-100-900 p-4">
      <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-adaptive-amber-700-300">
        Usage limit reached
      </Text>
      <Text className="font-sans text-sm leading-normal text-adaptive-neutral-600-400">
        {pause.isDue
          ? `The limit reset at ${pause.clockLabel}.`
          : `The limit resets in ${pause.countdown}, at ${pause.clockLabel}.`}
      </Text>
      <View className="flex-row flex-wrap gap-2.5">
        <Pressable
          className="items-center justify-center rounded-[14px] bg-blue-500 px-3.5 py-3"
          onPress={props.onResumeNow}
        >
          <Text className="font-t3-extrabold text-sm text-white">Resume now</Text>
        </Pressable>
        <Pressable
          className="items-center justify-center rounded-[14px] bg-adaptive-neutral-200-800 px-3.5 py-3"
          onPress={props.onDismiss}
        >
          <Text className="font-t3-bold text-sm text-adaptive-neutral-950-50">Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}
