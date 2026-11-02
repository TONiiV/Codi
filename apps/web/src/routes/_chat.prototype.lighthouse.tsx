import { createFileRoute } from "@tanstack/react-router";

import {
  LighthousePrototypePage,
  type LighthouseSearch,
} from "../components/prototype/LighthousePrototype";

// PROTOTYPE, wipe me. See components/prototype/LighthousePrototype.tsx.
export const Route = createFileRoute("/_chat/prototype/lighthouse")({
  validateSearch: (raw: Record<string, unknown>): LighthouseSearch => ({
    variant: raw.variant === "B" || raw.variant === "C" ? raw.variant : "A",
    as: raw.as === "lead" || raw.as === "member" ? raw.as : "admin",
    chat:
      raw.chat === "codi" || raw.chat === "site" || raw.chat === "app" || raw.chat === "desk"
        ? raw.chat
        : "mine",
  }),
  component: LighthousePrototypePage,
});
