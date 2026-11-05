// @effect-diagnostics nodeBuiltinImport:off - a standalone script run with `node`, outside the Effect runtime.
// Re-measures the agent context budget after an upstream merge. The Codi rename only shortens
// the measured text, so the measured values are taken when none grew. A grown value means text
// was added, which needs the evals in evals/README.md first: the file is left alone and this
// exits 1.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

const BUDGET = "apps/server/src/provider/agentContextBudget.json";
const TEST = "apps/server/src/provider/AgentContextBudget.test.ts";

// The failing test prints a diff of the committed budget (-) against the measured one (+).
export function nextBudget(committed: Record<string, number>, testOutput: string) {
  const measured = { ...committed };
  const plain = testOutput.replace(/\u001b\[[0-9;]*m/g, "");
  for (const [, key, value] of plain.matchAll(/^\+\s+"(\w+)": (\d+),?$/gm)) {
    if (key !== undefined && value !== undefined && key in committed) measured[key] = Number(value);
  }
  const keys = Object.keys(committed);
  return {
    measured,
    changed: keys.some((key) => measured[key] !== committed[key]),
    grew: keys.filter((key) => (measured[key] ?? 0) > (committed[key] ?? 0)),
  };
}

if (import.meta.main) {
  const committed: Record<string, number> = JSON.parse(NodeFS.readFileSync(BUDGET, "utf8"));
  const run = NodeChildProcess.spawnSync("vp", ["test", "run", TEST], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  if (run.status === 0) {
    process.stdout.write("Agent context budget already matches.\n");
  } else {
    const { measured, changed, grew } = nextBudget(committed, `${run.stdout}\n${run.stderr}`);
    if (!changed) {
      process.stderr.write(`Could not read measured values from the ${TEST} output.\n`);
      process.exit(1);
    }
    if (grew.length > 0) {
      process.stderr.write(
        `${grew.join(", ")} grew. Run the evals in evals/README.md before raising it.\n`,
      );
      process.exit(1);
    }
    NodeFS.writeFileSync(BUDGET, `${JSON.stringify(measured, null, 2)}\n`);
    process.stdout.write(`Updated ${BUDGET}.\n`);
  }
}
