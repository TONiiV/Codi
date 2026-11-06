import { createFileRoute } from "@tanstack/react-router";

import { telescopeBoardBody } from "../components/telescope/TelescopeBoardBody";
import { TelescopePage } from "../components/telescope/TelescopeShell";
import { parseTelescopeView, type TelescopeView } from "../components/telescope/telescopeViews";

export const Route = createFileRoute("/_chat/telescope")({
  validateSearch: (raw: Record<string, unknown>): { view: TelescopeView } => ({
    view: parseTelescopeView(raw.view),
  }),
  component: function TelescopeRoute() {
    const { view } = Route.useSearch();
    return <TelescopePage view={view}>{telescopeBoardBody(view)}</TelescopePage>;
  },
});
