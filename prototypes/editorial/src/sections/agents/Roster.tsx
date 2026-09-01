import { PROVIDER_ORDER, PROVIDERS, STATUS_LABEL, STATUS_TONE } from "../../mock/providers";
import type { Agent, ProviderId } from "../../mock/types";
import {
  agentsFor,
  selectAgent,
  setAgentModel,
  setAgentProvider,
  teamsFor,
  useApp,
} from "../../store/app";
import { shallowEqual } from "../../store/store";
import { Avatar, cx, Selector, StatusDot } from "../../ui/primitives";

function AgentRow({ agent }: { agent: Agent }) {
  const selected = useApp((s) => s.selectedAgentId === agent.id);
  const provider = PROVIDERS[agent.provider];

  return (
    <li className={cx("border-t border-rule first:border-t-0", selected && "bg-card")}>
      <button
        type="button"
        onClick={() => selectAgent(agent.id)}
        className="flex w-full items-center gap-3 px-3 py-3 text-left"
      >
        <Avatar glyph={agent.glyph} size={30} dim={agent.status === "idle"} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="text-[13.5px] font-medium text-ink">{agent.name}</span>
            <span className="eyebrow text-faint">{agent.latin}</span>
          </span>
          <span className="mt-1 flex items-center gap-1.5">
            <StatusDot status={agent.status} />
            <span className={cx("text-[11.5px]", STATUS_TONE[agent.status])}>
              {STATUS_LABEL[agent.status]}
            </span>
            <span className="truncate text-[11.5px] text-muted">· {agent.role}</span>
          </span>
        </span>
      </button>

      {selected ? (
        <div className="space-y-3 px-3 pb-4">
          <p className="body-cjk text-[12.5px] text-muted">{agent.activity}</p>
          <div className="flex flex-wrap gap-2">
            <Selector<ProviderId>
              label="PROVIDER"
              value={agent.provider}
              options={PROVIDER_ORDER.map((id) => ({ value: id, label: PROVIDERS[id].label }))}
              onChange={(next) => setAgentProvider(agent.id, next, PROVIDERS[next].models[0]!)}
            />
            <Selector
              label="MODEL"
              value={agent.model}
              options={provider.models.map((model) => ({ value: model, label: model }))}
              onChange={(next) => setAgentModel(agent.id, next)}
            />
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function Roster() {
  const personaId = useApp((s) => s.personaId);
  const agents = useApp((s) => agentsFor(s, s.personaId), shallowEqual);
  const teams = teamsFor(personaId);

  return (
    <div className="space-y-8">
      {teams.map((team) => {
        const members = agents.filter((agent) => agent.teamId === team.id);
        if (members.length === 0) return null;
        const busy = members.filter((agent) => agent.status !== "idle").length;
        return (
          <section key={team.id}>
            <div className="flex items-baseline justify-between px-3 pb-2">
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-medium text-ink">{team.name}</span>
                <span className="eyebrow text-faint">{team.latin}</span>
              </div>
              <span className="num text-[11.5px] text-muted">
                {busy}/{members.length}
              </span>
            </div>
            <ul className="overflow-hidden rounded-[12px] border border-rule bg-paper-sunk/40">
              {members.map((agent) => (
                <AgentRow key={agent.id} agent={agent} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
