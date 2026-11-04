import type { ComponentProps } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { CHATGPT_USAGE_URL } from "@t3tools/shared/usageLimits";
import { ensureLocalApi } from "../../localApi";
import { Button } from "../ui/button";
import { useTranslation } from "react-i18next";

export function ChatGptUsageButton(props: Omit<ComponentProps<typeof Button>, "onClick">) {
  const { t } = useTranslation();
  return (
    <Button
      variant="ghost-muted"
      size="sm"
      {...props}
      onClick={() => void ensureLocalApi().shell.openExternal(CHATGPT_USAGE_URL)}
    >
      {t("settings.text.manageUsage")}
      <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
    </Button>
  );
}
