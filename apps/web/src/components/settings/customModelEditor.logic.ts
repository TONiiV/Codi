import {
  type ModelCapabilities,
  ProviderDriverKind,
  type ProviderOptionDescriptor,
} from "@t3tools/contracts";
import { type CustomModelDefinition, createModelCapabilities } from "@t3tools/shared/model";
import type { TFunction } from "i18next";
import { englishT } from "~/i18n/englishT";

export interface EditorChoice {
  readonly key: string;
  readonly id: string;
  readonly label: string;
  readonly isDefault: boolean;
  readonly description?: string;
}

export interface EditorDescriptor {
  readonly key: string;
  readonly type: "select" | "boolean";
  readonly id: string;
  readonly label: string;
  readonly choices: ReadonlyArray<EditorChoice>;
  readonly currentBooleanValue?: boolean | undefined;
  readonly description?: string | undefined;
}

export interface CustomModelDraft {
  readonly slug: string;
  readonly name: string;
  readonly descriptors: ReadonlyArray<EditorDescriptor>;
}

export interface DescriptorPreset {
  readonly id: string;
  readonly labelKey: string;
  readonly type: "select" | "boolean";
  readonly choices?: ReadonlyArray<{ id: string; labelKey: string; isDefault?: boolean }>;
}

const EFFORT_CHOICES = [
  { id: "low", labelKey: "settings.parallelProviders.presetLow" },
  { id: "medium", labelKey: "settings.parallelProviders.presetMedium", isDefault: true },
  { id: "high", labelKey: "settings.parallelProviders.presetHigh" },
  { id: "xhigh", labelKey: "settings.parallelProviders.presetExtraHigh" },
] as const;

export const DESCRIPTOR_PRESETS_BY_KIND: Partial<
  Record<ProviderDriverKind, ReadonlyArray<DescriptorPreset>>
> = {
  [ProviderDriverKind.make("codex")]: [
    {
      id: "reasoningEffort",
      labelKey: "settings.parallelProviders.presetReasoning",
      type: "select",
      choices: EFFORT_CHOICES,
    },
    {
      id: "serviceTier",
      labelKey: "settings.parallelProviders.presetSpeed",
      type: "select",
      choices: [
        { id: "default", labelKey: "settings.parallelProviders.presetStandard", isDefault: true },
        { id: "fast", labelKey: "settings.parallelProviders.presetFast" },
      ],
    },
  ],
  [ProviderDriverKind.make("claudeAgent")]: [
    {
      id: "effort",
      labelKey: "settings.parallelProviders.presetReasoning",
      type: "select",
      choices: [
        { id: "low", labelKey: "settings.parallelProviders.presetLow" },
        { id: "medium", labelKey: "settings.parallelProviders.presetMedium" },
        { id: "high", labelKey: "settings.parallelProviders.presetHigh", isDefault: true },
        { id: "xhigh", labelKey: "settings.parallelProviders.presetExtraHigh" },
        { id: "max", labelKey: "settings.parallelProviders.presetMax" },
      ],
    },
    {
      id: "fastMode",
      labelKey: "settings.parallelProviders.presetFastMode",
      type: "boolean",
    },
    {
      id: "thinking",
      labelKey: "settings.parallelProviders.presetThinking",
      type: "boolean",
    },
  ],
  [ProviderDriverKind.make("cursor")]: [
    {
      id: "reasoning",
      labelKey: "settings.parallelProviders.presetReasoning",
      type: "select",
      choices: EFFORT_CHOICES,
    },
    {
      id: "fastMode",
      labelKey: "settings.parallelProviders.presetFastMode",
      type: "boolean",
    },
    {
      id: "thinking",
      labelKey: "settings.parallelProviders.presetThinking",
      type: "boolean",
    },
  ],
  [ProviderDriverKind.make("grok")]: [
    {
      id: "reasoningEffort",
      labelKey: "settings.parallelProviders.presetReasoning",
      type: "select",
      choices: EFFORT_CHOICES,
    },
  ],
  [ProviderDriverKind.make("pi")]: [
    {
      id: "thinking",
      labelKey: "settings.parallelProviders.presetThinking",
      type: "select",
      choices: [
        { id: "off", labelKey: "settings.parallelProviders.presetOff" },
        { id: "minimal", labelKey: "settings.parallelProviders.presetMinimal" },
        { id: "low", labelKey: "settings.parallelProviders.presetLow" },
        { id: "medium", labelKey: "settings.parallelProviders.presetMedium", isDefault: true },
        { id: "high", labelKey: "settings.parallelProviders.presetHigh" },
        { id: "xhigh", labelKey: "settings.parallelProviders.presetExtraHigh" },
        { id: "max", labelKey: "settings.parallelProviders.presetMax" },
      ],
    },
  ],
  [ProviderDriverKind.make("opencode")]: [
    {
      id: "variant",
      labelKey: "settings.parallelProviders.presetReasoning",
      type: "select",
      choices: EFFORT_CHOICES,
    },
    {
      id: "agent",
      labelKey: "settings.parallelProviders.presetAgent",
      type: "select",
      choices: [
        { id: "build", labelKey: "settings.parallelProviders.presetBuild", isDefault: true },
        { id: "plan", labelKey: "settings.parallelProviders.presetPlan" },
      ],
    },
  ],
};

let nextKey = 0;
function newEditorKey(): string {
  nextKey += 1;
  return `k${nextKey}`;
}

export function choiceFromPreset(
  choice: {
    id: string;
    labelKey: string;
    isDefault?: boolean;
  },
  t: TFunction = englishT,
): EditorChoice {
  return {
    key: newEditorKey(),
    id: choice.id,
    label: t(choice.labelKey),
    isDefault: !!choice.isDefault,
  };
}

export function descriptorFromPreset(
  preset: DescriptorPreset,
  t: TFunction = englishT,
): EditorDescriptor {
  return {
    key: newEditorKey(),
    type: preset.type,
    id: preset.id,
    label: t(preset.labelKey),
    choices: (preset.choices ?? []).map((choice) => choiceFromPreset(choice, t)),
  };
}

export function emptyEditorDescriptor(): EditorDescriptor {
  return { key: newEditorKey(), type: "select", id: "", label: "", choices: [] };
}

export function emptyEditorChoice(): EditorChoice {
  return { key: newEditorKey(), id: "", label: "", isDefault: false };
}

/** Custom entries lack runtime profiles for prompt-injected choices, so do not store them as ordinary
 * options. */
function descriptorToEditor(descriptor: ProviderOptionDescriptor): EditorDescriptor {
  const promptInjected = new Set(
    descriptor.type === "select" ? (descriptor.promptInjectedValues ?? []) : [],
  );
  const choices =
    descriptor.type === "select"
      ? descriptor.options.filter((option) => !promptInjected.has(option.id))
      : [];
  const defaultChoice =
    choices.find((option) => option.id === descriptor.currentValue) ??
    choices.find((option) => option.isDefault);
  return {
    key: newEditorKey(),
    type: descriptor.type,
    id: descriptor.id,
    label: descriptor.label,
    ...(descriptor.description !== undefined ? { description: descriptor.description } : {}),
    ...(descriptor.type === "boolean" && descriptor.currentValue !== undefined
      ? { currentBooleanValue: descriptor.currentValue }
      : {}),
    choices: choices.map((option) => ({
      key: newEditorKey(),
      id: option.id,
      label: option.label,
      ...(option.description !== undefined ? { description: option.description } : {}),
      isDefault: option === defaultChoice,
    })),
  };
}

export function draftFromDefinition(entry: CustomModelDefinition): CustomModelDraft {
  return {
    slug: entry.slug,
    name: entry.name === entry.slug ? "" : entry.name,
    descriptors: (entry.capabilities?.optionDescriptors ?? []).map(descriptorToEditor),
  };
}

/** Claude context choices require runtime suffix mappings that custom entries do not carry. */
export function descriptorsFromCapabilities(
  capabilities: ModelCapabilities | null | undefined,
  driverKind: ProviderDriverKind | null,
): EditorDescriptor[] {
  return (capabilities?.optionDescriptors ?? [])
    .filter((descriptor) => driverKind !== "claudeAgent" || descriptor.id !== "contextWindow")
    .map(descriptorToEditor);
}

export function validateDraft(draft: CustomModelDraft, t: TFunction = englishT): string | null {
  const seenIds = new Set<string>();
  for (const [index, descriptor] of draft.descriptors.entries()) {
    const position = t("settings.parallelProviders.optionNumber", { number: index + 1 });
    const id = descriptor.id.trim();
    if (!id) return t("settings.text.positionNeedsAnId", { position });
    if (seenIds.has(id)) return t("settings.text.positionIdIdIsUsedTwice", { position, id });
    seenIds.add(id);
    if (!descriptor.label.trim())
      return t("settings.parallelProviders.positionNeedsALabel", { position });
    if (descriptor.type !== "select") continue;
    if (descriptor.choices.length === 0)
      return t("settings.text.positionNeedsAtLeastOneChoice", { position });
    const seenChoices = new Set<string>();
    for (const choice of descriptor.choices) {
      const choiceId = choice.id.trim();
      if (!choiceId) return t("settings.text.positionHasAChoiceWithoutA", { position });
      if (seenChoices.has(choiceId)) {
        return t("settings.text.positionChoiceChoiceidIsUsedTwice", { position, choiceId });
      }
      seenChoices.add(choiceId);
    }
  }
  return null;
}

export function definitionFromDraft(draft: CustomModelDraft): CustomModelDefinition {
  const descriptors: ProviderOptionDescriptor[] = draft.descriptors.map((descriptor) => {
    const id = descriptor.id.trim();
    const label = descriptor.label.trim();
    if (descriptor.type === "boolean") {
      return {
        id,
        label,
        type: "boolean",
        ...(descriptor.description !== undefined ? { description: descriptor.description } : {}),
        ...(descriptor.currentBooleanValue !== undefined
          ? { currentValue: descriptor.currentBooleanValue }
          : {}),
      };
    }
    const options = descriptor.choices.map((choice) => ({
      id: choice.id.trim(),
      label: choice.label.trim() || choice.id.trim(),
      ...(choice.description !== undefined ? { description: choice.description } : {}),
      ...(choice.isDefault ? { isDefault: true } : {}),
    }));
    const currentValue = options.find((option) => option.isDefault)?.id;
    return {
      id,
      label,
      type: "select",
      ...(descriptor.description !== undefined ? { description: descriptor.description } : {}),
      options,
      ...(currentValue ? { currentValue } : {}),
    };
  });
  const name = draft.name.trim();
  return {
    slug: draft.slug,
    name: name || draft.slug,
    capabilities:
      descriptors.length > 0 ? createModelCapabilities({ optionDescriptors: descriptors }) : null,
  };
}
