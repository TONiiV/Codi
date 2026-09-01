# Codi · 人物主页原型 — "Editorial"

A throwaway, fully mocked clickable prototype for the persona-workspace product concept.
Design direction: **calm, high-contrast, magazine-like** — near-black sidebar, off-white paper,
hairline rules, essentially monochrome, colour reserved for signal only.

This is not wired to a server, a websocket, or any provider CLI. Everything is fixture data.

## Run it

```bash
cd prototypes/editorial
npm install
npm run dev      # http://localhost:5181
```

The port is pinned to `5181` with `strictPort`, so this can run alongside the other prototypes.

```bash
npm run build    # typecheck + production build
```

Use **npm** here, not `vp` or `pnpm` — `prototypes/` is deliberately outside the pnpm workspace.

## The design motif

Every section is introduced the same way: a small all-caps latin **eyebrow**, a large bold Chinese
**headline**, a small muted Chinese **subtitle**. That rhythm is the spine of the whole app, and
`SectionHead` in `src/ui/primitives.tsx` is the one component that expresses it.

Typography is doing the work that colour usually does. Speakers in a chat transcript are
distinguished by weight and an eyebrow, not by coloured bubbles. Decision-tree branches are
distinguished by border style (solid = chosen, dashed = rejected, dashed amber = still open), not
by fills.

## What is clickable

- **Personas** — the sidebar list swaps the entire workspace: agents, projects, todos, decisions.
- **今天** — quick-capture tabs change the prompt and the note list; submitting adds a real note.
- **智能体** — switch threads, click a roster entry to expand its provider/model pickers and jump
  to a thread it speaks in, change provider or model from the roster or the composer.
- **@-mentions** — type `@` in the composer for an agent autocomplete (arrows, Enter/Tab, Escape).
  Sending a message that mentions an agent makes that agent answer; if it is new to the thread it
  joins with a visible rule in the transcript. Replies stream character by character, and an agent
  will sometimes hand off to a teammate, who answers with a `↳ 回复 X` attribution.
- **项目** — switch projects; live agent rows tick elapsed time and token burn; decision-tree nodes
  expand and collapse with the `+` / `−` control.
- **日历** — filter by project and by label, switch between 日程 and 甘特图, and toggle focus mode
  (全部 / 未来 1 天 / 未来 3 小时). Focus mode hides the filter chrome and enlarges what is left.
- **⌘K** — command palette over personas, sections, agents, projects and todos.

## Editing the fixtures

All content lives in `src/mock/` and is meant to be edited by hand:

| File | What it holds |
| --- | --- |
| `personas.ts` | Personas, teams, and the agent roster (name, role, provider, model, status) |
| `providers.ts` | The five providers and their model lists |
| `threads.ts` | Threads and their seeded transcripts, including tool calls and diff cards |
| `replies.ts` | Canned replies agents stream back, and the `{@}` handoff templates |
| `projects.ts` | Roadmaps, milestones, live work, and the decision trees |
| `calendar.ts` | Todos and quick-capture seeds |

Todo times are expressed as `startH` / `durH` in **hours relative to app boot**, so "接下来三小时"
is always meaningful whenever you open the prototype.

## Performance notes

The store in `src/store/store.ts` gives selector-scoped subscriptions, so while a reply streams
only that one message re-renders rather than the whole transcript. The only continuous animation
is the streaming caret; elapsed-time readouts tick once a second and only while their panel is
mounted.
