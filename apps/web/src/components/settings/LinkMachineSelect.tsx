import type { LinkableMachine } from "@t3tools/client-runtime/link-request";
import { useId } from "react";

import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Badge } from "../ui/badge";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { useTranslation } from "react-i18next";

/** The machine choice for linking by an address typed in. */
export const ANOTHER_ADDRESS = "another-address";

/** Whether a machine is linked already, or how this app knows it when not connected to it. */
export function LinkMachineBadge({ machine }: { readonly machine: LinkableMachine }) {
  const { t } = useTranslation();
  if (machine.linked) {
    return (
      <Badge variant="success" size="sm">
        {t("settings.text.linked")}
      </Badge>
    );
  }
  if (machine.connected) return null;
  return (
    <Badge variant="outline" size="sm">
      {machine.connectOnly ? "T3 Connect" : t("settings.text.notConnected")}
    </Badge>
  );
}

function MachineName({ machine }: { readonly machine: LinkableMachine }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <EnvironmentMachineIcon kind={machine.machine} className="size-4 shrink-0 opacity-80" />
      <span className="min-w-0 truncate">{machine.label}</span>
    </span>
  );
}

/** The user's other machines, including those on their T3 Connect account, then an address. */
export function LinkMachineSelect({
  machines,
  value,
  onChange,
  disabled,
}: {
  readonly machines: ReadonlyArray<LinkableMachine>;
  readonly value: string | null;
  readonly onChange: (value: string) => void;
  readonly disabled: boolean;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  return (
    <div className="space-y-1.5">
      <span id={labelId} className="block text-xs font-medium text-foreground">
        {t("settings.text.machine")}
      </span>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (next !== null) onChange(next as string);
        }}
      >
        <SelectTrigger aria-labelledby={labelId}>
          <SelectValue>
            {(selected: string | null) => {
              if (selected === ANOTHER_ADDRESS) return t("settings.text.anotherAddress");
              const machine = machines.find((candidate) => candidate.environmentId === selected);
              return machine === undefined ? (
                t("settings.parallelConnections.chooseAMachine")
              ) : (
                <MachineName machine={machine} />
              );
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {machines.map((machine) => (
            <SelectItem key={machine.environmentId} value={machine.environmentId} hideIndicator>
              <span className="flex min-w-0 items-center justify-between gap-3">
                <MachineName machine={machine} />
                <LinkMachineBadge machine={machine} />
              </span>
            </SelectItem>
          ))}
          <SelectItem value={ANOTHER_ADDRESS} hideIndicator>
            {t("settings.text.anotherAddress")}
          </SelectItem>
        </SelectPopup>
      </Select>
    </div>
  );
}
