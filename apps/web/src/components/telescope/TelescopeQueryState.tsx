import { Telescope } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { ReactNode } from "react";

import type { EnvironmentQueryView } from "../../state/query";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

const isWorkspaceError = Schema.is(Telescope.WorkspaceError);

// Partial: a reason with no read-specific text (e.g. `invalid`) gets the generic fallback.
const READ_ERROR_TEXT: Partial<Record<Telescope.WorkspaceError["reason"], string>> = {
  not_found: "找不到这个工作区，请刷新后再试。",
  forbidden: "你没有权限查看这些内容。",
  expired: "已经过期，请刷新后再试。",
  conflict: "和当前状态冲突，请刷新后再试。",
  storage: "服务器读取出错，请稍后再试。",
};

/** Renders a Telescope read: the data, a retry on failure, a spinner while it loads. */
export function QueryState<A>({
  query,
  children,
}: {
  query: EnvironmentQueryView<A>;
  children: (data: A) => ReactNode;
}) {
  if (query.data !== null) return children(query.data);
  if (query.error !== null)
    return (
      <Alert variant="error">
        <AlertDescription>
          读取失败：
          {(isWorkspaceError(query.failure) ? READ_ERROR_TEXT[query.failure.reason] : undefined) ??
            "请检查连接后再试。"}
        </AlertDescription>
        <AlertAction>
          <Button size="xs" variant="outline" onClick={query.refresh}>
            重试
          </Button>
        </AlertAction>
      </Alert>
    );
  return (
    <div className="flex justify-center py-10">
      <Spinner size="lg" tone="muted" />
    </div>
  );
}
