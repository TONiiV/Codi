import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { DeviceToolVersions as ToolVersions } from "@t3tools/contracts";
import { InlineButton } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";

const R = "settings.remaining.";
const TOOL_LABEL_KEYS = {
  hub: "settings.text.deviceHub",
  agent: "settings.remaining.agentDevice",
} as const satisfies Record<keyof ToolVersions, string>;

export function DeviceToolVersions({
  tools,
  action,
  kind,
  owner,
  error,
}: {
  tools: ToolVersions | undefined;
  action?: ReactNode;
  kind?: keyof ToolVersions;
  owner?: string | undefined;
  error?: string | undefined;
}) {
  const { t } = useTranslation();
  const selected = kind ? tools?.[kind] : undefined;
  const version =
    selected?.runningVersion ??
    (selected?.installedVersions.includes(selected.requiredVersion)
      ? selected.requiredVersion
      : selected?.installedVersions
          .toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .at(-1));
  const label = kind ? t(TOOL_LABEL_KEYS[kind]) : undefined;
  return (
    <Popover>
      <PopoverTrigger
        aria-label={
          kind
            ? t(`${R}toolStatusAria`, {
                label,
                status: version
                  ? t(`${R}toolVersion`, { version })
                  : t(selected ? `${R}toolNotInstalled` : `${R}toolVersionUnknown`),
              })
            : undefined
        }
        render={<InlineButton tone="muted" />}
      >
        {kind
          ? version
            ? `v${version}`
            : t(selected ? "settings.text.notInstalled" : `${R}versionUnknown`)
          : t(error ? `${R}versionsUnavailable` : `${R}versions`)}
      </PopoverTrigger>
      <PopoverPopup align="end" width="md">
        <PopoverTitle>{label ?? t(`${R}deviceTools`)}</PopoverTitle>
        {tools ? (
          <div className="mt-4 divide-y divide-border/50">
            {(["hub", "agent"] as const)
              .filter((name) => !kind || name === kind)
              .map((name) => {
                const tool = tools[name];
                return (
                  <div key={name} className="space-y-2 py-3 first:pt-0 last:pb-0">
                    {!kind ? (
                      <p className="text-xs font-medium">{t(TOOL_LABEL_KEYS[name])}</p>
                    ) : null}
                    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs">
                      <dt className="text-muted-foreground">{t(`${R}running`)}</dt>
                      <dd className="text-right font-mono">
                        {tool.runningVersion ?? t(`${R}notRunning`)}
                      </dd>
                      <dt className="text-muted-foreground">{t(`${R}required`)}</dt>
                      <dd className="text-right font-mono">{tool.requiredVersion}</dd>
                      <dt className="text-muted-foreground">{t(`${R}installed`)}</dt>
                      <dd className="text-right font-mono break-words">
                        {tool.installedVersions.join(", ") || t("settings.text.none")}
                      </dd>
                    </dl>
                  </div>
                );
              })}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">{t(`${R}versionsNotChecked`)}</p>
        )}
        <p className="mt-4 border-t border-border/50 pt-3 text-xs text-muted-foreground">
          {owner
            ? t(`${R}sentencePair`, {
                first: t(`${R}managedBy`, { owner }),
                second: t(`${R}toolsUpdateAutomatically`),
              })
            : t(`${R}toolsUpdateAutomatically`)}
        </p>
        {error ? (
          <p role="status" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </PopoverPopup>
    </Popover>
  );
}
