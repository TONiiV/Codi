import { APP_VERSION } from "../../branding";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { InlineButton } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useTranslation } from "react-i18next";

export function AboutVersionTitle() {
  const { t } = useTranslation();
  const { copyToClipboard } = useCopyToClipboard<void>({
    target: "version",
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("settings.text.couldNotCopyVersion"),
          description: error.message,
        }),
      );
    },
  });

  return (
    <span className="inline-flex items-baseline gap-2">
      <span>{t("settings.text.version")}</span>
      <code className="text-2xs font-medium">
        <Tooltip>
          <TooltipTrigger
            render={
              <InlineButton
                tone="muted"
                aria-label={t("settings.text.copyVersionAppVersion", { APP_VERSION })}
                onClick={() => copyToClipboard(APP_VERSION, undefined)}
              >
                {APP_VERSION}
              </InlineButton>
            }
          />
          <TooltipPopup>{t("settings.text.copyVersion")}</TooltipPopup>
        </Tooltip>
      </code>
    </span>
  );
}
