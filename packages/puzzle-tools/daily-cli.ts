import { mkdir, writeFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PrivateStore,
  privateRoot,
  safeName,
  readJson,
} from "./private-store.ts";
import { inventory } from "./inventory.ts";
import { prepareDaily, validateDailyPlan } from "./daily.ts";
import { DailyRehearsal } from "./daily-rehearsal.ts";
const rehearsalParent = fileURLToPath(
  new URL("../../evidence/daily-rehearsals/", import.meta.url),
);
async function savedPlan(name: string) {
  const file = resolve(
    privateRoot,
    "daily",
    safeName(name),
    "plan.PRIVATE.json",
  );
  if ((await realpath(file)) !== file)
    throw Error("Daily plan must not use symlinks");
  return readJson(file, 1100000);
}
const [command, ...args] = process.argv.slice(2);
try {
  const o: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      ![
        "--workspace",
        "--id",
        "--edition",
        "--name",
        "--previous-name",
        "--rehearsal",
        "--head",
        "--actor",
        "--reason",
      ].includes(args[i]) ||
      !args[i + 1] ||
      args[i] in o
    )
      throw Error("Invalid daily option");
    o[args[i]] = args[i + 1];
  }
  const allowed: Record<string, string[]> = {
    status: ["--workspace"],
    prepare: ["--workspace", "--id", "--edition", "--name", "--previous-name"],
    verify: ["--workspace", "--name", "--previous-name"],
    rehearse: ["--workspace", "--name", "--previous-name", "--rehearsal"],
    "inspect-rehearsal": ["--rehearsal"],
    "recall-rehearsal": [
      "--rehearsal",
      "--head",
      "--id",
      "--actor",
      "--reason",
    ],
    "delay-rehearsal": ["--rehearsal", "--head", "--actor", "--reason"],
    "refresh-rehearsal": [
      "--workspace",
      "--rehearsal",
      "--head",
      "--actor",
      "--reason",
    ],
    "commit-rehearsal": [
      "--workspace",
      "--name",
      "--previous-name",
      "--rehearsal",
      "--head",
    ],
  };
  if (
    !(command in allowed) ||
    Object.keys(o).some((k) => !allowed[command].includes(k))
  )
    throw Error("Unknown daily command or command option");
  if (
    ["inspect-rehearsal", "recall-rehearsal", "delay-rehearsal"].includes(
      command,
    )
  ) {
    if (!o["--rehearsal"]) throw Error("Rehearsal name required");
    const store = new DailyRehearsal(
      resolve(rehearsalParent, safeName(o["--rehearsal"])),
    );
    if (command !== "inspect-rehearsal") {
      if (!o["--head"] || !o["--actor"] || !o["--reason"])
        throw Error("Head, actor and reason required");
      if (command === "recall-rehearsal") {
        if (!o["--id"]) throw Error("Published puzzle ID required");
        await store.recall(
          o["--id"],
          () => new Date().toISOString(),
          o["--head"],
          o["--actor"],
          o["--reason"],
        );
      } else
        await store.markDelayed(
          () => new Date().toISOString(),
          o["--head"],
          o["--actor"],
          o["--reason"],
        );
    }
    const { hash, state, archive } = await store.read();
    console.log(
      JSON.stringify({
        status: "local_rehearsal_only",
        hash,
        publication_count: state.catalog.history.total_released,
        active_id: state.manifest?.active.puzzle_id ?? null,
        release_status: state.manifest?.release_status ?? "not_started",
        recalled_count: state.manifest?.recalled_ids.length ?? 0,
        archive_count: archive?.entries.length ?? null,
        production_activated: false,
      }),
    );
  } else {
    const c = await new PrivateStore(
      safeName(o["--workspace"] ?? "main"),
    ).read();
    // Previous means a verified, committed local snapshot, not an unexecuted plan.
    const previousState = o["--previous-name"]
      ? await new DailyRehearsal(
          resolve(rehearsalParent, safeName(o["--previous-name"])),
        ).read()
      : undefined;
    const previous = previousState?.state.manifest ?? undefined;
    if (o["--previous-name"] && !previous)
      throw Error("Previous rehearsal has no committed daily manifest");
    if (command === "refresh-rehearsal") {
      if (!o["--rehearsal"] || !o["--head"] || !o["--actor"] || !o["--reason"])
        throw Error("Rehearsal, head, actor and reason required");
      const result = await new DailyRehearsal(
        resolve(rehearsalParent, safeName(o["--rehearsal"])),
      ).refreshCatalog(
        c,
        () => new Date().toISOString(),
        o["--head"],
        o["--actor"],
        o["--reason"],
      );
      console.log(
        JSON.stringify({
          status: "local_rehearsal_only",
          hash: result.hash,
          catalog_revision: result.state.catalog.revision,
          production_activated: false,
        }),
      );
    } else if (command === "status") {
      if (Object.keys(o).some((k) => k !== "--workspace"))
        throw Error("Status accepts only workspace");
      const result = inventory(c);
      console.log(
        JSON.stringify({
          status:
            result.ready >= 30
              ? "quality_stock_ready"
              : "human_review_stock_incomplete",
          ready: result.ready,
          required: 30,
          source_revision: c.revision,
          publication_implemented: true,
          status_scope: "human_review_inventory",
          publication_policy: "machine-verified-human-trial-waived-20261017",
          production_status_command: "npm run production -- status",
          local_atomic_rehearsal_implemented: true,
        }),
      );
    } else if (command === "prepare") {
      if (!o["--id"] || !o["--edition"] || !o["--name"])
        throw Error("Prepare requires id, edition and safe output name");
      const plan = prepareDaily(
        c,
        o["--id"],
        o["--edition"],
        new Date().toISOString(),
        previous,
        previousState?.archive,
      );
      const parent = resolve(privateRoot, "daily");
      await mkdir(parent, { recursive: true, mode: 0o700 });
      if ((await realpath(parent)) !== parent)
        throw Error("Private output must not use symlinks");
      const target = resolve(parent, safeName(o["--name"]));
      await mkdir(target, { mode: 0o700 });
      await writeFile(
        resolve(target, "plan.PRIVATE.json"),
        JSON.stringify(plan, null, 2),
        { flag: "wx", mode: 0o600 },
      );
      console.log(
        JSON.stringify({
          status: "private_prepared_only",
          source_revision: c.revision,
        }),
      );
    } else {
      if (!o["--name"]) throw Error("Saved private plan name required");
      const plan = validateDailyPlan(
        await savedPlan(o["--name"]),
        c,
        new Date().toISOString(),
        previous,
        previousState?.archive,
      );
      if (command === "verify")
        console.log(
          JSON.stringify({
            status: "private_plan_revalidated",
            source_revision: c.revision,
            production_activated: false,
          }),
        );
      else {
        if (!o["--rehearsal"]) throw Error("Local rehearsal name required");
        const root = resolve(rehearsalParent, safeName(o["--rehearsal"]));
        let store: DailyRehearsal;
        if (command === "rehearse") {
          await mkdir(rehearsalParent, { recursive: true, mode: 0o700 });
          store = await DailyRehearsal.initialize(root, c);
        } else {
          if (!o["--head"] || !/^[a-f0-9]{64}$/.test(o["--head"]))
            throw Error("Expected rehearsal head hash required");
          store = new DailyRehearsal(root);
        }
        const result = await store.commit(
          plan,
          () => new Date().toISOString(),
          o["--head"] ?? (await store.read()).hash,
        );
        console.log(
          JSON.stringify({
            status: "local_rehearsal_only",
            hash: result.hash,
            unchanged: result.unchanged,
            publication_count: result.state.catalog.history.total_released,
            production_activated: false,
          }),
        );
      }
    }
  }
} catch (error) {
  console.error("Daily preparation blocked:", (error as Error).message);
  process.exitCode = 2;
}
