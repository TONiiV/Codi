import {
  agentsFor,
  currentThreadId,
  projectById,
  selectThread,
  threadById,
  threadsFor,
  useApp,
} from "../../store/app";
import { shallowEqual } from "../../store/store";
import { Avatar, cx, SectionHead } from "../../ui/primitives";
import { Composer } from "./Composer";
import { Roster } from "./Roster";
import { Transcript } from "./Transcript";

function ThreadTabs() {
  const personaId = useApp((s) => s.personaId);
  const activeId = useApp(currentThreadId);
  const threads = threadsFor(personaId);

  return (
    <div className="flex flex-wrap gap-x-7 gap-y-2 border-b border-rule pb-4">
      {threads.map((thread) => {
        const active = thread.id === activeId;
        return (
          <button
            key={thread.id}
            type="button"
            onClick={() => selectThread(thread.id)}
            className="group text-left"
          >
            <div className={cx("eyebrow", active ? "text-ink" : "text-faint")}>{thread.latin}</div>
            <div
              className={cx(
                "mt-1.5 text-[14px] transition-colors",
                active ? "font-medium text-ink" : "text-muted group-hover:text-ink-2",
              )}
            >
              {thread.title}
            </div>
            <div
              className={cx("mt-2 h-px w-full", active ? "bg-ink" : "bg-transparent")}
              aria-hidden
            />
          </button>
        );
      })}
    </div>
  );
}

function ThreadParticipants() {
  const threadId = useApp(currentThreadId);
  const participants = useApp((s) => s.participants[threadId] ?? [], shallowEqual);
  const agents = useApp((s) => agentsFor(s, s.personaId), shallowEqual);

  return (
    <div className="flex items-center gap-2">
      {participants.map((id) => {
        const agent = agents.find((a) => a.id === id);
        if (!agent) return null;
        return (
          <span key={id} className="flex items-center gap-1.5" title={agent.role}>
            <Avatar glyph={agent.glyph} size={22} dim={agent.status === "idle"} />
            <span className="text-[12px] text-muted">{agent.name}</span>
          </span>
        );
      })}
    </div>
  );
}

export function AgentsView() {
  const threadId = useApp(currentThreadId);
  const agentCount = useApp((s) => agentsFor(s, s.personaId).length);
  const runningCount = useApp(
    (s) => agentsFor(s, s.personaId).filter((a) => a.status !== "idle").length,
  );
  const thread = threadById(threadId);
  const project = thread ? projectById(thread.projectId) : undefined;

  return (
    <div className="mx-auto max-w-[1320px] px-10 py-10">
      <SectionHead
        eyebrow="AGENTS"
        headline="智能体协作"
        subtitle={`${agentCount} 位智能体，${runningCount} 位正在工作。在对话里用 @ 呼叫任何一位，他会当场加入。`}
      />

      <div className="mt-9 grid grid-cols-1 gap-10 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="order-2 xl:order-1">
          <div className="eyebrow pb-4 text-faint">ROSTER · 名册</div>
          <Roster />
        </div>

        <div className="order-1 min-w-0 xl:order-2">
          <ThreadTabs />

          {thread ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4 py-6">
                <div>
                  <div className="eyebrow text-faint">{project?.latin ?? "THREAD"}</div>
                  <h3 className="headline mt-2 text-[22px] text-ink">{thread.title}</h3>
                  <p className="mt-1.5 text-[12.5px] text-muted">
                    所属项目 · {project?.name ?? "未归属"}
                  </p>
                </div>
                <ThreadParticipants />
              </div>

              <Transcript />

              <div className="sticky bottom-0 -mx-1">
                <div className="h-8 bg-gradient-to-b from-transparent to-paper" />
                <div className="bg-paper pb-8">
                  <Composer />
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
