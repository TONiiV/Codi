// PROTOTYPE, wipe me. A workspace invite as a conversation pinned to the top of the chat list.
// Accepting switches to the workspace; either answer removes the pinned chat. Declining offers a
// short undo, after which the invite is gone.
import { useNavigate } from "@tanstack/react-router";
import { BuildingIcon, UserRoundIcon } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { WORKSPACE_KIND, type LighthouseViewer } from "./lighthouseData";
import { acceptInvite, declineInvite, restoreInvite, type WorkspaceInvite } from "./workspaceStore";

export function PersonAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  return (
    <span
      className={
        size === "sm"
          ? "inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-2xs font-medium text-primary-foreground"
          : "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground"
      }
    >
      {name[0]}
    </span>
  );
}

export function InviteChatPage({
  viewer,
  invite,
}: {
  viewer: LighthouseViewer;
  invite: WorkspaceInvite;
}) {
  const navigate = useNavigate();
  const toMine = () =>
    void navigate({
      to: "/prototype/lighthouse",
      search: { as: viewer, chat: "mine", view: "chats" },
    });
  const decline = () => {
    declineInvite(invite);
    toMine();
    const id = toastManager.add({
      type: "info",
      title: `已拒绝 ${invite.workspace.name} 的邀请`,
      actionProps: {
        children: "撤销",
        onClick: () => {
          toastManager.close(id);
          restoreInvite(invite);
        },
      },
    });
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
      <div className="mx-auto flex w-full max-w-(--chat-content-max-width) flex-col gap-6 px-5 py-6">
        <p className="text-center text-xs text-muted-foreground">
          工作区邀请。接受或拒绝后，这条对话会从列表里消失。
        </p>
        <div className="flex gap-3">
          <PersonAvatar name={invite.from} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{invite.from}</span>
              <span className="tabular-nums">{invite.at}</span>
            </div>
            <p className="text-sm">{invite.note}</p>
            <div className="flex max-w-md flex-col gap-3 rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2">
                <BuildingIcon className="size-4 text-muted-foreground" />
                <span className="font-medium">{invite.workspace.name}</span>
                <Badge variant="outline" size="sm">
                  {WORKSPACE_KIND[invite.workspace.kind]}
                </Badge>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">你的角色</dt>
                <dd>{invite.role}</dd>
                <dt className="text-muted-foreground">已经在里面</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {invite.members.map((m) => (
                    <span key={m} className="inline-flex items-center gap-1">
                      <UserRoundIcon className="size-3 text-muted-foreground" />
                      {m}
                    </span>
                  ))}
                </dd>
              </dl>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={() => {
                    acceptInvite(invite);
                    toMine();
                  }}
                >
                  接受并进入
                </Button>
                <Button size="sm" variant="outline" onClick={decline}>
                  拒绝
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
