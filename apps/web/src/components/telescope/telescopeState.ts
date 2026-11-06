import { useAtomValue } from "@effect/atom-react";
import { createTelescopeBoardAtoms } from "@t3tools/client-runtime/telescope/taskBoard";
import { createTelescopeWorkspaceAtoms } from "@t3tools/client-runtime/telescope/workspaces";
import { Telescope } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../../connection/runtime";
import { getLocalStorageItem, setLocalStorageItem } from "../../hooks/useLocalStorage";
import { usePrimaryEnvironmentId } from "../../state/environments";

const CURRENT_WORKSPACE_KEY = "t3code:telescope:current-workspace:v1";

export const telescope = createTelescopeWorkspaceAtoms(connectionAtomRuntime, {
  read: () => {
    try {
      return getLocalStorageItem(CURRENT_WORKSPACE_KEY, Telescope.WorkspaceId);
    } catch {
      return null;
    }
  },
  write: (workspaceId) => {
    try {
      setLocalStorageItem(CURRENT_WORKSPACE_KEY, workspaceId, Telescope.WorkspaceId);
    } catch {
      // The choice still holds for this session when storage is blocked.
    }
  },
});

export const telescopeBoard = createTelescopeBoardAtoms(connectionAtomRuntime);

export const WORKSPACE_KIND_LABEL = { enterprise: "企业", personal: "个人" } as const;

const noWorkspaceAtom = Atom.make<Telescope.Workspace | null>(null);
const noBindingsAtom = Atom.make<ReadonlyArray<Telescope.ProjectBinding>>([]);

/** Telescope lives on the primary environment: one machine shared by its members. */
export function useTelescopeWorkspaces() {
  const environmentId = usePrimaryEnvironmentId();
  const current = useAtomValue(
    environmentId === null ? noWorkspaceAtom : telescope.currentWorkspaceAtom(environmentId),
  );
  const bindings = useAtomValue(
    environmentId === null ? noBindingsAtom : telescope.allBindingsAtom(environmentId),
  );
  return { environmentId, current, bindings };
}
