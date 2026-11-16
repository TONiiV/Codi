import type { ProjectId } from "@t3tools/contracts";
import { createContext } from "react";

/** The mount a Telescope file tab is bound to, so links in the file it shows open on that mount. */
export const FileMountContext = createContext<ProjectId | undefined>(undefined);
