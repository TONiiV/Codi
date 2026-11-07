import { InlineButton } from "../ui/button";
import { useId, useState } from "react";

import { cn } from "../../lib/utils";
import { useTranslation } from "react-i18next";

export function ExpandableText({
  text,
  collapsedText = text,
  className,
  collapsedClassName = "line-clamp-3",
  expandLabel: expandLabelProp,
}: {
  text: string;
  collapsedText?: string;
  className?: string;
  collapsedClassName?: string;
  expandLabel?: string;
}) {
  const { t } = useTranslation();
  const expandLabel = expandLabelProp ?? t("settings.text.showFullError");
  const textId = useId();
  const [expanded, setExpanded] = useState(false);
  const canExpand = collapsedText !== text || text.length > 180 || text.includes("\n");

  return (
    <div className={cn("min-w-0", className)}>
      <div
        id={textId}
        className={cn(
          "whitespace-pre-wrap break-words",
          !expanded && canExpand ? collapsedClassName : null,
        )}
      >
        {expanded ? text : collapsedText}
      </div>
      {canExpand ? (
        <InlineButton
          aria-expanded={expanded}
          aria-controls={textId}
          tone="muted"
          className="mt-1"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t("settings.text.showLess") : expandLabel}
        </InlineButton>
      ) : null}
    </div>
  );
}
