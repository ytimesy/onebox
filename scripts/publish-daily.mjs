import { resolve } from "node:path";
import {
  readFile,
  realpath,
  mkdir,
  copyFile,
  writeFile,
} from "node:fs/promises";
import { PrivateStore } from "../packages/puzzle-tools/private-store.ts";
import {
  policy,
  stageProduction,
  activateProduction,
  withProductionLock,
  needsDailyPublication,
} from "./production-release.mjs";
import { checkProductionBrowser } from "./check-production.mjs";
import { digest } from "../packages/puzzle-tools/generator.ts";
const base = resolve(import.meta.dirname, ".."),
  command = process.argv[2] ?? "status",
  allowed = ["status", "publish", "refresh", "recall"];
if (
  !allowed.includes(command) ||
  process.argv.length > (command === "recall" ? 4 : 3) ||
  (command === "recall" &&
    !/^onebox-\d{4}-\d{2}-\d{2}$/.test(process.argv[3] ?? ""))
)
  throw Error("Use status, publish, refresh, or recall onebox-YYYY-MM-DD");
const current = await realpath(resolve(base, "var/current")),
  manifest = JSON.parse(
    await readFile(resolve(current, "release.json"), "utf8"),
  );
const now = () => new Date().toISOString();
async function alreadyPublished(root, manifest) {
  if (manifest.stage !== "daily") return false;
  const state = JSON.parse(
    await readFile(resolve(root, "../state.PRIVATE.json"), "utf8"),
  );
  return !needsDailyPublication(state.plan, now());
}
if (command === "status") {
  let state;
  if (manifest.stage === "daily")
    state = JSON.parse(
      await readFile(resolve(current, "../state.PRIVATE.json"), "utf8"),
    );
  console.log(
    JSON.stringify({
      stage: manifest.stage,
      edition: manifest.active.edition_utc,
      policy: state ? policy : null,
      human_trial_acceptance: "not_performed",
      publications: state?.plan.ledger.records.length ?? 0,
      remaining_at_publication: state?.plan.remaining ?? null,
      stock_level: state
        ? state.plan.remaining < 7
          ? "action_required"
          : state.plan.remaining < 14
            ? "warning"
            : "ok"
        : null,
      release_status: manifest.release_status,
    }),
  );
} else if (command === "publish" && (await alreadyPublished(current, manifest)))
  console.log(
    JSON.stringify({
      status: "already_published_today",
      edition: manifest.active.edition_utc,
    }),
  );
else
  await withProductionLock(base, async () => {
    const latest = await realpath(resolve(base, "var/current")),
      latestManifest = JSON.parse(
        await readFile(resolve(latest, "release.json"), "utf8"),
      );
    if (
      command === "publish" &&
      (await alreadyPublished(latest, latestManifest))
    )
      return;
    const practiceRoot =
      latestManifest.stage === "playtest"
        ? latest
        : JSON.parse(
            await readFile(
              resolve(base, "var/production/practice.json"),
              "utf8",
            ),
          ).root;
    if (latestManifest.stage === "playtest") {
      try {
        await writeFile(
          resolve(base, "var/production/practice.json"),
          JSON.stringify({ root: practiceRoot }),
          { flag: "wx", mode: 0o600 },
        );
      } catch (e) {
        if (
          e.code !== "EEXIST" ||
          JSON.parse(
            await readFile(
              resolve(base, "var/production/practice.json"),
              "utf8",
            ),
          ).root !== practiceRoot
        )
          throw e;
      }
    }
    const catalog = await new PrivateStore().read();
    const staged = await stageProduction({
      base,
      shell: resolve(base, "dist-production-shell"),
      practiceRoot,
      catalog,
      at: now(),
      options: command === "recall" ? { recall: process.argv[3] } : {},
    });
    // All browser observations use fresh throwaway contexts and never create human reports.
    if (
      command !== "recall" ||
      staged.state.plan.manifest.release_status !== "unavailable"
    )
      console.log(
        (
          await checkProductionBrowser(staged.publicRoot, {
            allEngines: process.env.ONEBOX_ALL_ENGINES === "1",
            evidence: process.env.ONEBOX_PRODUCTION_EVIDENCE,
          })
        ).join("\n"),
      );
    const result = await activateProduction(
      base,
      staged,
      await new PrivateStore().read(),
      now,
    );
    console.log(JSON.stringify(result));
  });
