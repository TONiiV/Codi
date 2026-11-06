import { createFileRoute } from "@tanstack/react-router";

import { LighthousePrototypePage } from "../components/prototype/LighthousePrototype";
import {
  normalizeLighthouseSearch,
  type LighthouseSearch,
} from "../components/prototype/lighthouseLocation";

// PROTOTYPE, wipe me. See components/prototype/LighthousePrototype.tsx.
export const Route = createFileRoute("/_chat/prototype/lighthouse")({
  validateSearch: (raw: Record<string, unknown>): LighthouseSearch =>
    normalizeLighthouseSearch(raw),
  component: () => <LighthousePrototypePage />,
});
