import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
  writeFile,
  mkdtemp,
  mkdir,
  symlink,
  realpath,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  emptyCatalog,
  importBatch,
} from "../packages/puzzle-tools/curation.ts";
import { generate, digest } from "../packages/puzzle-tools/generator.ts";
import {
  policy,
  planProduction,
  stageProduction,
  activateProduction,
  withProductionLock,
  checkProductionSite,
  needsDailyPublication,
} from "../scripts/production-release.mjs";
import { checkProductionBrowser } from "../scripts/check-production.mjs";
const at = "2026-10-17T01:00:00.000Z",
  next = "2026-10-18T00:00:01.000Z";
const practiceRoot = resolve("dist-playtest"),
  practiceManifest = JSON.parse(
    await readFile(resolve(practiceRoot, "release.json"), "utf8"),
  ),
  practice = JSON.parse(
    await readFile(practiceRoot + practiceManifest.active.payload_url, "utf8"),
  );
const catalog = emptyCatalog();
// Dedicated synthetic test seeds; never reuse private delivery candidate seeds.
for (let i = 0; i < 3; i++) {
  const batch = generate({ seed: 701001 + i, count: 10 });
  assert.equal(batch.complete, true);
  importBatch(catalog, batch, "production-test-" + i, "test", at);
}
async function setup(t) {
  const base = await realpath(
    await mkdtemp(resolve(tmpdir(), "onebox-production-")),
  );
  await mkdir(resolve(base, "var"));
  await symlink(practiceRoot, resolve(base, "var/current"));
  t.after(() => rm(base, { recursive: true, force: true }));
  return base;
}
const stage = (base) =>
  stageProduction({
    base,
    shell: resolve("dist-production-shell"),
    practiceRoot,
    catalog,
    at,
  });
test("explicit machine policy launches without invented human approvals, keeps source immutable and requires 30 launch candidates", () => {
  const before = digest(catalog),
    p = planProduction(catalog, undefined, practice, at);
  assert.equal(digest(catalog), before);
  assert.equal(p.ledger.policy, policy);
  assert.equal(p.ledger.records.length, 1);
  assert.equal(p.remaining, 29);
  assert(
    catalog.entries.every(
      (e) =>
        e.stage === "candidate" && e.trials.length === 0 && e.review === null,
    ),
  );
  const short = structuredClone(catalog);
  short.entries.pop();
  assert.throws(
    () => planProduction(short, undefined, practice, at),
    /30 machine-verified/,
  );
  const nextPlan = planProduction(catalog, p.ledger, practice, next);
  assert.equal(nextPlan.ledger.records.length, 2);
  assert.equal(nextPlan.remaining, 28);
  assert.notEqual(
    nextPlan.ledger.records[0].source_id,
    nextPlan.ledger.records[1].source_id,
  );
  assert.deepEqual(nextPlan.ledger.records[0], p.ledger.records[0]);
  const again = planProduction(catalog, p.ledger, practice, at);
  assert.equal(again.ledger.records.length, 1);
  assert.equal(again.manifest.active.sha256, p.manifest.active.sha256);
  const exhausted = structuredClone(catalog);
  for (const e of exhausted.entries) e.stage = "rejected";
  const delayed = planProduction(exhausted, p.ledger, practice, next);
  assert.equal(delayed.manifest.release_status, "delayed");
  assert.equal(delayed.manifest.active.puzzle_id, p.manifest.active.puzzle_id);
  assert.equal(delayed.ledger.records.length, 1);
  assert.equal(delayed.remaining, 0);
  assert.equal(needsDailyPublication(p, at), false);
  assert.equal(needsDailyPublication(p, next), true);
  assert.equal(needsDailyPublication(delayed, next), false);
  const controlled = planProduction(catalog, p.ledger, practice, next, {
    recall: p.manifest.active.puzzle_id,
  });
  assert.equal(needsDailyPublication(controlled, next), true);
  const bad = structuredClone(p.ledger);
  bad.records[0].puzzle.pieces.reverse();
  assert.throws(
    () => planProduction(catalog, bad, practice, next),
    /integrity/,
  );
});
test("staged release allowlists only current/past public data, detects mutations, CAS, UTC, source changes and concurrent writer", async (t) => {
  const base = await setup(t),
    s = await withProductionLock(base, () => stage(base));
  assert.equal(await realpath(resolve(base, "var/current")), practiceRoot);
  const checked = await checkProductionSite(s.publicRoot);
  assert.equal(checked.archive.entries.length, 1);
  assert.equal(checked.practice.active.sha256, practiceManifest.active.sha256);
  await assert.rejects(
    activateProduction(base, s, catalog, () => next),
    /UTC changed/,
  );
  const changed = structuredClone(catalog);
  changed.revision++;
  await assert.rejects(
    activateProduction(base, s, changed, () => at),
    /Source catalog changed/,
  );
  await withProductionLock(base, () =>
    assert.rejects(
      withProductionLock(base, () => {}),
      /writer locked/,
    ),
  );
  await writeFile(resolve(s.publicRoot, "future.PRIVATE.json"), "{}");
  await assert.rejects(
    checkProductionSite(s.publicRoot),
    /Unlisted public file/,
  );
  await rm(resolve(s.publicRoot, "future.PRIVATE.json"));
  const assets = await readdir(resolve(s.publicRoot, "assets")),
    js = assets.find((n) => n.endsWith(".js"));
  await writeFile(resolve(s.publicRoot, "assets", js), "// altered");
  await assert.rejects(
    activateProduction(base, s, catalog, () => at),
    /changed after browser check/,
  );
  assert.equal(await realpath(resolve(base, "var/current")), practiceRoot);
});
test("atomic activation retains legacy URLs, past daily bytes, rejects unpublished/withdrawn payloads and preserves valid head on failure", async (t) => {
  const base = await setup(t);
  const first = await stage(base);
  await activateProduction(base, first, catalog, () => at);
  const second = await stageProduction({
    base,
    shell: resolve("dist-production-shell"),
    practiceRoot,
    catalog,
    at: next,
  });
  await activateProduction(base, second, catalog, () => next);
  assert.deepEqual(
    second.state.plan.ledger.records[0],
    first.state.plan.ledger.records[0],
  );
  assert.equal(await realpath(resolve(base, "var/previous")), first.publicRoot);
  // A candidate based on an older head must never overwrite the new head.
  await assert.rejects(
    activateProduction(base, first, catalog, () => at),
    /head changed/,
  );
  const recalled = await stageProduction({
    base,
    shell: resolve("dist-production-shell"),
    practiceRoot,
    catalog,
    at: "2026-10-18T00:01:00.000Z",
    options: { recall: first.state.plan.manifest.active.puzzle_id },
  });
  await activateProduction(
    base,
    recalled,
    catalog,
    () => "2026-10-18T00:01:00.000Z",
  );
  const child = spawn(
    process.execPath,
    [resolve("scripts/static-server.mjs")],
    {
      env: {
        ...process.env,
        ONEBOX_SERVE_ROOT: recalled.publicRoot,
        ONEBOX_PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const [out] = await once(child.stdout, "data");
  const origin = "http://127.0.0.1:" + String(out).match(/:(\d+)/)[1];
  try {
    for (const l of ["ja", "en"]) {
      assert.equal((await fetch(origin + `/${l}/`)).status, 200);
      assert.equal(
        (await fetch(origin + `/${l}/p/playtest-fixed-v1/`)).status,
        200,
      );
      assert.equal(
        (await fetch(origin + `/${l}/p/onebox-2026-10-17/`)).status,
        410,
      );
      assert.equal(
        (await fetch(origin + `/${l}/p/onebox-2099-01-01/`)).status,
        404,
      );
    }
    assert.equal(
      (await fetch(origin + first.state.plan.manifest.active.payload_url))
        .status,
      404,
    );
    assert.equal(
      (await fetch(origin + second.state.plan.manifest.active.payload_url))
        .status,
      200,
    );
    assert.equal((await fetch(origin + "/state.PRIVATE.json")).status, 404);
    assert.equal((await fetch(origin + "/api/candidates")).status, 404);
    assert.equal(
      (await fetch(origin + "/ja/?src=share&run_id=secret")).status,
      404,
    );
    assert.equal(
      (await fetch(origin + "/ja/", { method: "POST" })).status,
      405,
    );
    assert.equal(
      (await fetch(origin + "/ja/", { method: "HEAD" })).status,
      200,
    );
    assert.match(
      await (await fetch(origin + "/robots.txt")).text(),
      /Allow: \//,
    );
    assert.equal(
      (await (await fetch(origin + "/health")).json()).stage,
      "daily",
    );
  } finally {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
});
test(
  "fresh browser verifies new daily and real older daily/legacy practice routes before activation",
  { timeout: 120000 },
  async (t) => {
    const base = await setup(t);
    const first = await stage(base);
    await activateProduction(base, first, catalog, () => at);
    const second = await stageProduction({
      base,
      shell: resolve("dist-production-shell"),
      practiceRoot,
      catalog,
      at: next,
    });
    const lines = await checkProductionBrowser(second.publicRoot);
    assert.equal(lines.filter((l) => l.includes("PASS")).length, 7);
    assert.equal(
      await realpath(resolve(base, "var/current")),
      first.publicRoot,
    );
  },
);
