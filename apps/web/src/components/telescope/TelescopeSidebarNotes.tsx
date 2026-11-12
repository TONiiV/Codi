import type { ReactNode } from "react";

import { Button } from "../ui/button";

export function SidebarNote({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1 text-xs text-sidebar-muted-foreground">{children}</p>;
}

export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1">
      <span className="text-xs text-sidebar-muted-foreground">读取失败</span>
      <Button size="xs" variant="outline" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}
