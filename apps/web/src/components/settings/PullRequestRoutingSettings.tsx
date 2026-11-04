import { useAtomValue } from "@effect/atom-react";
import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import {
  pullRequestRoutingConnectionKey,
  pullRequestRoutingPermissionFor,
  type PullRequestRoutingPermission,
} from "@t3tools/client-runtime/connection";
import { useState } from "react";

import { environmentCatalog } from "~/connection/catalog";
import type { EnvironmentPresentation } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { EnvironmentRow, EnvironmentTransportLabel } from "./EnvironmentRow";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { searchableSetting } from "./settingsSearch";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

const options: ReadonlyArray<{ value: PullRequestRoutingPermission; label: string }> = [
  { value: "off", label: "settings.manual.prRouting.off" },
  { value: "read", label: "settings.manual.prRouting.read" },
  { value: "read-write", label: "settings.manual.prRouting.readWrite" },
];

const summaryLabels = {
  "read-write": "settings.manual.prRouting.summaryReadWrite",
  read: "settings.manual.prRouting.summaryRead",
} as const;

function summarizePullRequestRouting(
  entries: ReadonlyArray<{
    readonly label: string;
    readonly permission: PullRequestRoutingPermission;
  }>,
  t: TFunction,
): string | null {
  const groups = (["read-write", "read"] as const).flatMap((permission) => {
    const labels = entries.filter((entry) => entry.permission === permission);
    return labels.length === 0
      ? []
      : [`${labels.map((entry) => entry.label).join(", ")} ${t(summaryLabels[permission])}`];
  });
  return groups.length === 0 ? null : groups.join(" · ");
}

export function PullRequestRoutingSettings({
  environments,
}: {
  readonly environments: ReadonlyArray<EnvironmentPresentation>;
}) {
  const { t } = useTranslation();
  const permissions = useAtomValue(environmentCatalog.pullRequestRoutingPermissionsValueAtom);
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const update = useAtomCommand(environmentCatalog.setPullRequestRoutingPermission);
  const [saving, setSaving] = useState(false);

  if (environments.length < 2) return null;

  const { id, title } = searchableSetting("pull-request-routing");
  return (
    <FoldedSettingsSection
      id={id}
      title={title}
      summary={
        summarizePullRequestRouting(
          environments.map((environment) => ({
            label: environment.label,
            permission: pullRequestRoutingPermissionFor(environment.entry, permissions),
          })),
          t,
        ) ?? t("settings.text.off")
      }
    >
      <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
        {t("settings.text.machinesYouTrustHereCanRead")}
      </p>
      {environments.map((environment) => (
        <EnvironmentRow
          key={environment.environmentId}
          kind={resolveEnvironmentMachineKind(environment.serverConfig)}
          label={environment.label}
          subtitle={<EnvironmentTransportLabel environment={environment} />}
        >
          <Select
            items={options}
            value={pullRequestRoutingPermissionFor(environment.entry, permissions)}
            disabled={
              !catalog.isReady ||
              saving ||
              pullRequestRoutingConnectionKey(environment.entry) === null
            }
            onValueChange={(permission) => {
              if (permission === null) return;
              setSaving(true);
              void update({ environmentId: environment.environmentId, permission }).then(
                (result) => {
                  setSaving(false);
                  if (result._tag === "Failure")
                    toastManager.add({
                      type: "error",
                      title: t("settings.text.couldNotSavePullRequestRouting"),
                    });
                },
              );
            }}
          >
            <SelectTrigger
              size="xs"
              className="w-32"
              aria-label={t("settings.text.labelPullRequestRouting", { label: environment.label })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {options.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {t(label)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </EnvironmentRow>
      ))}
    </FoldedSettingsSection>
  );
}
