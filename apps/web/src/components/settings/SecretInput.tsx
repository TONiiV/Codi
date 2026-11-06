import { DraftInput, type DraftInputProps } from "../ui/draft-input";
import { Input, type InputProps } from "../ui/input";
import { useTranslation } from "react-i18next";

type SecretInputProps = Omit<InputProps, "type" | "autoComplete" | "defaultValue" | "value"> & {
  /** Pass only the replacement draft as `value`. */
  readonly configured?: boolean;
  readonly value: string;
  readonly onCommit?: DraftInputProps["onCommit"];
};

export function SecretInput({
  configured = false,
  placeholder,
  onCommit,
  ...props
}: SecretInputProps) {
  const { t } = useTranslation();
  const shared = {
    ...props,
    type: "password" as const,
    autoComplete: "off",
    spellCheck: false,
    placeholder: configured
      ? t("settings.text.storedSecretEnterANewValue")
      : (placeholder ?? t("settings.text.notSet")),
  };
  if (onCommit) {
    return (
      <DraftInput
        {...shared}
        onCommit={(next) => {
          if (configured && next === "") return;
          onCommit(next);
        }}
      />
    );
  }
  return <Input {...shared} />;
}
