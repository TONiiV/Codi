import type { ComponentProps } from "react";
import { OpenAI } from "../Icons";
import { Button } from "../ui/button";
import { useTranslation } from "react-i18next";

export function ChatGptConnectionButton({ children, ...props }: ComponentProps<typeof Button>) {
  const { t } = useTranslation();
  return (
    <Button {...props}>
      <OpenAI className="size-4 shrink-0" aria-hidden="true" />
      {children ?? t("settings.text.continueWithChatgpt")}
    </Button>
  );
}
