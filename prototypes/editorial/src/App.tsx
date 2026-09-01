import { CalendarView } from "./sections/calendar/CalendarView";
import { AgentsView } from "./sections/agents/AgentsView";
import { ProjectsView } from "./sections/projects/ProjectsView";
import { TodayView } from "./sections/TodayView";
import { CommandPalette } from "./shell/CommandPalette";
import { Sidebar } from "./shell/Sidebar";
import { TopBar } from "./shell/TopBar";
import { useApp } from "./store/app";

export function App() {
  const section = useApp((s) => s.section);
  const personaId = useApp((s) => s.personaId);

  return (
    <div className="flex h-full bg-shell">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-l-[20px] bg-paper">
        <TopBar />
        {/* Keyed on persona so switching identity resets scroll, the way
            opening a different magazine would. */}
        <main key={personaId} className="min-h-0 flex-1 overflow-y-auto">
          {section === "today" ? <TodayView /> : null}
          {section === "agents" ? <AgentsView /> : null}
          {section === "projects" ? <ProjectsView /> : null}
          {section === "calendar" ? <CalendarView /> : null}
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
