import { createFileRoute } from "@tanstack/react-router";

import { TelescopeSettingsPanel } from "../components/telescope/TelescopeSettings";

export const Route = createFileRoute("/_chat/settings/telescope")({
  component: TelescopeSettingsPanel,
});
