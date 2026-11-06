import { createFileRoute } from "@tanstack/react-router";

import { TelescopePage } from "../components/telescope/TelescopeShell";
import { parseTelescopeView, type TelescopeView } from "../components/telescope/telescopeViews";

export const Route = createFileRoute("/_chat/telescope")({
  validateSearch: (raw: Record<string, unknown>): { view: TelescopeView } => ({
    view: parseTelescopeView(raw.view),
  }),
  component: function TelescopeRoute() {
    return <TelescopePage view={Route.useSearch().view} />;
  },
});
