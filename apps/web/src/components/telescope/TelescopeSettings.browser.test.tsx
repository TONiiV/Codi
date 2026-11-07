import { EnvironmentId, Telescope } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { MembersSection } from "./TelescopeSettings";

const environmentId = EnvironmentId.make("local");
const workspaceId = Telescope.WorkspaceId.make("ws");
const member = (subjectId: string, fields: Partial<Telescope.Member> = {}): Telescope.Member => ({
  workspaceId,
  subjectId,
  displayName: subjectId,
  role: "member",
  joinedAt: "2026-11-07T00:00:00.000Z",
  ...fields,
});
const self = member("me", { role: "admin" });
const commands = vi.hoisted(() => ({ calls: [] as string[] }));

function setup() {
  commands.calls = [];
}

vi.mock(import("./TelescopeAccountDialogs"), async (original) => ({
  ...(await original()),
  useFreshMembers: () => ({
    data: {
      members: [self, member("left", { revokedAt: "2026-11-07T00:00:00.000Z" })],
    },
    dataUpdatedAt: 0,
    error: null,
    failure: null,
    isPending: false,
    isSuccess: true,
    refresh: () => {},
  }),
}));

vi.mock(import("./telescopeState"), async (original) => {
  const actual = await original();
  const allowed = { permissionAtom: () => Atom.make(true) };
  return {
    ...actual,
    telescope: {
      ...actual.telescope,
      setRole: { ...actual.telescope.setRole, ...allowed },
      revoke: { ...actual.telescope.revoke, ...allowed },
      restore: { ...actual.telescope.restore, ...allowed },
    },
  };
});

vi.mock(import("../../state/use-atom-command"), () => ({
  // Never settles, so the row stays busy for as long as the test looks.
  useAtomCommand: (_command, label) => () => {
    commands.calls.push(String(label));
    return new Promise(() => {});
  },
}));

describe("MembersSection", () => {
  it("sends one restore for a double click while the first is in flight", async () => {
    setup();
    await using _screen = await render(
      <MembersSection
        environmentId={environmentId}
        workspace={{
          id: workspaceId,
          kind: "enterprise",
          name: "ws",
          createdAt: "2026-11-07T00:00:00.000Z",
          createdBy: "me",
        }}
        self={self}
      />,
    );
    const restore = page.getByRole("button", { name: "恢复" });
    await userEvent.dblClick(restore);
    await expect.element(restore).toBeDisabled();
    expect(commands.calls).toEqual(["恢复成员"]);
  });
});
