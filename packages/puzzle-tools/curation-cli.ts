import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verify } from "./generator.ts";
import { inventory } from "./inventory.ts";
import {
  type Catalog,
  type Entry,
  importBatch,
  checkEntry,
  findEntry,
  startTrial,
  addTrial,
  approve,
  queue,
  reject,
  reopen,
  replaceHistory,
  trialSummary,
} from "./curation.ts";
import {
  PrivateStore,
  readJson,
  readBatch,
  safeName,
} from "./private-store.ts";

const project = fileURLToPath(new URL("../../", import.meta.url));
const [command, ...args] = process.argv.slice(2);
const allowed: Record<string, string[]> = {
  import: ["--batch", "--actor"],
  list: [],
  stock: [],
  inspect: ["--id"],
  "start-trial": ["--id", "--actor"],
  "record-trial": ["--id", "--actor", "--report"],
  approve: ["--id", "--review"],
  queue: ["--id", "--actor"],
  reject: ["--id", "--actor", "--notes"],
  reopen: ["--id", "--actor"],
  "import-history": ["--file", "--actor"],
};
function parse() {
  if (!(command in allowed))
    throw Error(
      "Use import, list, stock, inspect, start-trial, record-trial, approve, queue, reject, reopen, or import-history",
    );
  const o: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (
      ![...allowed[command], "--workspace"].includes(key) ||
      !args[i + 1] ||
      key in o
    )
      throw Error("Unknown, missing or repeated option");
    o[key] = args[i + 1];
  }
  for (const key of allowed[command])
    if (!o[key]) throw Error("Missing required command option");
  return o;
}
function independent(candidates: unknown) {
  // Python stdout/stderr never escapes into the CLI if a check fails.
  try {
    const report = JSON.parse(
      execFileSync("python3", ["-E", "verification/check_candidates.py", "-"], {
        cwd: project,
        input: JSON.stringify({ candidates }),
        encoding: "utf8",
        timeout: 10000,
        maxBuffer: 100000,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
    if (
      report.checked !== (candidates as unknown[]).length ||
      !report.reports.every(
        (r: any) => r.exact_cover_count === 1 && r.independent_dfs_count === 1,
      )
    )
      throw Error("Failed");
  } catch {
    throw Error("Independent Python verification failed");
  }
}
function summary(c: Catalog, e: Entry) {
  return {
    id: e.puzzle.puzzle_id,
    stage: e.stage,
    source_batch: e.source.batch,
    ...checkEntry(c, e),
    trials: trialSummary(e.trials),
    audit_events: e.events.length,
    versions: {
      ...e.source.versions,
      curation: c.curation_version,
      dedup_geometry: c.geometry_version,
    },
  };
}
try {
  const o = parse(),
    store = new PrivateStore(safeName(o["--workspace"] ?? "main"));
  const at = new Date().toISOString();
  let output: unknown;
  if (command === "stock") {
    output = inventory(await store.read(), at);
  } else if (command === "list") {
    const c = await store.read();
    output = {
      revision: c.revision,
      history_total: c.history.total_released,
      history_checked: c.history.items.length,
      entries: c.entries.map((e) => ({
        id: e.puzzle.puzzle_id,
        stage: e.stage,
        trial_summary: trialSummary(e.trials),
      })),
    };
  } else if (command === "inspect") {
    const c = await store.read();
    output = summary(c, findEntry(c, o["--id"]));
  } else {
    output = await store.mutate(async (c) => {
      if (command === "import") {
        const batch = await readBatch(safeName(o["--batch"]));
        const added = importBatch(c, batch, o["--batch"], o["--actor"], at);
        independent(added.map((a) => findEntry(c, a.id)));
        return {
          imported: added.length,
          duplicates_blocked: added.filter((a) => a.duplicates.length > 0)
            .length,
        };
      }
      if (command === "import-history") {
        replaceHistory(
          c,
          await readJson(o["--file"], 1000000),
          o["--actor"],
          at,
        );
        const started = performance.now();
        const checked = c.history.items.map((h) => {
          const remaining = Math.floor(10000 - (performance.now() - started));
          if (remaining < 1)
            throw Error("History verification budget exhausted");
          const v = verify(h.puzzle, 100000, Math.min(1500, remaining));
          if (
            v.status !== "unique" ||
            v.hash !== h.hash ||
            v.nodes !== h.solver_nodes
          )
            throw Error("History machine verification mismatch");
          return {
            puzzle: h.puzzle,
            construction: v.solution,
            verification: v,
          };
        });
        if (checked.length) independent(checked);
        return {
          history_total: c.history.total_released,
          history_checked: c.history.items.length,
        };
      }
      const id = o["--id"];
      if (command === "start-trial") startTrial(c, id, o["--actor"], at);
      else if (command === "record-trial")
        addTrial(c, id, await readJson(o["--report"], 8000), o["--actor"], at);
      else if (command === "approve") {
        independent([findEntry(c, id)]);
        approve(c, id, await readJson(o["--review"], 8000), at);
      } else if (command === "queue") {
        independent([findEntry(c, id)]);
        queue(c, id, o["--actor"], at);
      } else if (command === "reject")
        reject(c, id, o["--actor"], o["--notes"], at);
      else if (command === "reopen") reopen(c, id, o["--actor"], at);
      return summary(c, findEntry(c, id));
    });
  }
  console.log(JSON.stringify(output));
} catch (error) {
  console.error(
    error instanceof SyntaxError
      ? "Invalid JSON input"
      : error instanceof Error && !("code" in error)
        ? error.message
        : "Curation input or private filesystem operation failed",
  );
  process.exitCode = 2;
}
