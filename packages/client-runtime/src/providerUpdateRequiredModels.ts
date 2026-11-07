import { PROVIDER_DISPLAY_NAMES, type ServerProvider } from "@t3tools/contracts";
import { compareSemverVersions } from "@t3tools/shared/semver";

const RUNTIME_NAMES: Partial<Record<string, string>> = {
  claudeAgent: "Claude Code",
  codex: "Codex CLI",
};

function formatModelList(names: ReadonlyArray<string>): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function resolveProviderUpdateRequired(
  provider: Pick<ServerProvider, "driver" | "updateRequiredModels">,
  searchQuery = "",
) {
  const query = searchQuery.trim().toLocaleLowerCase();
  const models = (provider.updateRequiredModels ?? []).filter(
    (model) =>
      query.length === 0 ||
      model.name.toLocaleLowerCase().includes(query) ||
      model.slug.toLocaleLowerCase().includes(query),
  );
  if (models.length === 0) return null;
  const minVersion = models
    .map((model) => model.minVersion)
    .reduce((highest, version) =>
      compareSemverVersions(version, highest) > 0 ? version : highest,
    );
  return {
    providerName:
      RUNTIME_NAMES[provider.driver] ?? PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver,
    version: minVersion.startsWith("v") ? minVersion : `v${minVersion}`,
    modelNames: models.map((model) => model.name),
  };
}

export function formatProviderUpdateRequiredNotice(
  provider: Pick<ServerProvider, "driver" | "updateRequiredModels">,
  searchQuery = "",
): string | null {
  const update = resolveProviderUpdateRequired(provider, searchQuery);
  if (!update) return null;
  return `Update ${update.providerName} to ${update.version} or newer to use ${formatModelList(update.modelNames)}.`;
}
