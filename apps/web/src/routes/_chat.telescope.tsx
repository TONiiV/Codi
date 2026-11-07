import { createFileRoute } from "@tanstack/react-router";

import { telescopeBoardBody } from "../components/telescope/TelescopeBoardBody";
import { TelescopePage } from "../components/telescope/TelescopeShell";
import { parseTelescopeSearch } from "../components/telescope/telescopeViews";

export const Route = createFileRoute("/_chat/telescope")({
  validateSearch: parseTelescopeSearch,
  component: function TelescopeRoute() {
    const { view } = Route.useSearch();
    return <TelescopePage view={view}>{telescopeBoardBody(view)}</TelescopePage>;
  },
});
