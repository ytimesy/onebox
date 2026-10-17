import { afterEach, beforeAll, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  readlink,
  symlink,
  rm,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { syntheticQualityCatalog } from "../../tests/helpers/quality-catalog.ts";
import { DailyRehearsal } from "./daily-rehearsal.ts";
import { prepareDaily, validateDailyPlan, type DailyPlan } from "./daily.ts";
import { digest } from "./generator.ts";
import { emptyCatalog, type Catalog } from "./curation.ts";
import { validateManifest } from "../game-core/release.ts";
import { canonical } from "../game-core/index.ts";
import { PrivateStore, privateRoot } from "./private-store.ts";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
const at = "2026-10-17T00:00:01.000Z";
let catalog: Catalog, plan: DailyPlan;
const dirs: string[] = [];
beforeAll(() => {
  catalog = syntheticQualityCatalog(at);
  plan = prepareDaily(
    catalog,
    catalog.entries[0].puzzle.puzzle_id,
    "2026-10-17",
    at,
  );
}, 30000);
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function setup(c = catalog) {
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), "onebox-daily-commit-test-")),
  );
  dirs.push(parent);
  const root = join(parent, "trial"),
    store = await DailyRehearsal.initialize(root, c);
  return { root, store, before: await store.read() };
}
it("revalidates plans against current reviews, complete catalog hash, current UTC day and canonical contents", () => {
  expect(validateDailyPlan(plan, catalog, at)).toEqual(plan);
  expect(() =>
    validateDailyPlan(plan, { ...catalog, revision: catalog.revision + 1 }, at),
  ).toThrow("stale");
  const edited = structuredClone(catalog);
  edited.entries[0].review!.notes += " changed";
  expect(() => validateDailyPlan(plan, edited, at)).toThrow("stale");
  expect(() =>
    validateDailyPlan(plan, catalog, "2026-10-18T00:00:01.000Z"),
  ).toThrow("expired");
  for (const bad of [
    { ...plan, payload_json: "{}" },
    { ...plan, source_id: catalog.entries[1].puzzle.puzzle_id },
    { ...plan, solver_nodes: 1e6 },
    { ...plan, extra: "PRIVATE" },
  ])
    expect(() => validateDailyPlan(bad, catalog, at)).toThrow();
}, 30000);
it("atomically switches canonical payload, manifest and copied catalog/history, then replays exactly once", async () => {
  const { store, root, before } = await setup(),
    originalHash = digest(catalog);
  const activatedAt = "2026-10-17T00:00:05.000Z";
  const result = await store.commit(plan, activatedAt, before.hash);
  expect(result.unchanged).toBe(false);
  expect((await store.read()).hash).toBe(result.hash);
  expect(result.state.catalog.history.total_released).toBe(1);
  expect(result.state.catalog.revision).toBe(catalog.revision + 1);
  expect(result.state.sources[plan.manifest.active.puzzle_id]).toBe(
    plan.source_id,
  );
  expect(result.state.catalog.history.items[0].hash).toBe(
    plan.manifest.active.sha256,
  );
  const publicManifest = JSON.parse(
    await readFile(join(result.publicRoot, "release.json"), "utf8"),
  );
  expect(validateManifest(publicManifest)).toEqual({
    ...plan.manifest,
    published_at: activatedAt,
  });
  expect(result.state.catalog.history.items[0].published_at).toBe(activatedAt);
  const publicFiles = await readdir(result.publicRoot);
  expect(publicFiles.sort()).toEqual(["archives", "puzzles", "release.json"]);
  const data = await readFile(
    join(result.publicRoot, plan.manifest.active.payload_url.slice(1)),
    "utf8",
  );
  expect(data).toBe(plan.payload_json);
  expect(data).not.toMatch(/PRIVATE|seed|review|solution|construction|trials/);
  const count = (await readdir(join(root, "snapshots"))).length;
  expect(
    (await store.commit(plan, "2026-10-18T00:00:01.000Z", before.hash))
      .unchanged,
  ).toBe(true);
  expect((await store.read()).state.catalog.history.total_released).toBe(1);
  expect((await readdir(join(root, "snapshots"))).length).toBe(count);
  expect(digest(catalog)).toBe(originalHash);
}, 30000);
it("rejects a changed head, empty quality stock and tampering without changing current", async () => {
  const { store, before } = await setup();
  await expect(store.commit(plan, at, "f".repeat(64))).rejects.toThrow(
    "head changed",
  );
  await expect(
    store.commit({ ...plan, payload_json: "{}" }, at, before.hash),
  ).rejects.toThrow("integrity");
  expect((await store.read()).hash).toBe(before.hash);
  const empty = await setup(emptyCatalog());
  await expect(empty.store.commit(plan, at, empty.before.hash)).rejects.toThrow(
    "stale",
  );
  expect((await empty.store.read()).hash).toBe(empty.before.hash);
}, 30000);
it("holds the previous verified snapshot when validation fails, and safely retries completed staging", async () => {
  const { store, before, root } = await setup();
  await expect(
    store.commit(plan, at, before.hash, async () => {
      throw Error("staging check failed");
    }),
  ).rejects.toThrow("staging check failed");
  expect((await store.read()).hash).toBe(before.hash);
  expect((await readdir(join(root, "snapshots"))).length).toBe(2);
  const committed = await store.commit(plan, at, before.hash);
  expect(committed.state.catalog.history.total_released).toBe(1);
  await expect(
    store.commit({ ...plan, solver_nodes: 1e6 }, at, before.hash),
  ).rejects.toThrow("immutable");
}, 30000);
it("rejects staged data corruption and retains the old active catalog/manifest", async () => {
  const { store, before } = await setup();
  await expect(
    store.commit(plan, at, before.hash, async (pub) => {
      await writeFile(
        join(pub, "puzzles", `${plan.manifest.active.sha256}.json`),
        "{}",
      );
    }),
  ).rejects.toThrow("payload mismatch");
  expect((await store.read()).hash).toBe(before.hash);
}, 30000);
it("does not activate yesterday's ready edition if UTC changes while validation is running", async () => {
  const { store, before } = await setup();
  let now = at;
  await expect(
    store.commit(
      plan,
      () => now,
      before.hash,
      async () => {
        now = "2026-10-18T00:00:01.000Z";
      },
    ),
  ).rejects.toThrow("UTC day changed");
  expect((await store.read()).hash).toBe(before.hash);
  expect((await store.read()).state.catalog.history.total_released).toBe(0);
}, 30000);
it("serializes writers and leaves stale/foreign writer locks for inspection", async () => {
  const { store, before, root } = await setup();
  let staged!: () => void, release!: () => void;
  const arrived = new Promise<void>((r) => {
      staged = r;
    }),
    wait = new Promise<void>((r) => {
      release = r;
    });
  const writer = store.commit(plan, at, before.hash, async () => {
    staged();
    await wait;
  });
  await arrived;
  await expect(store.commit(plan, at, before.hash)).rejects.toThrow("locked");
  expect((await store.read()).hash).toBe(before.hash);
  release();
  await writer;
  await mkdir(join(root, "writer.lock"));
  await expect(store.commit(plan, at, before.hash)).rejects.toThrow("inspect");
  expect(await readdir(root)).toContain("writer.lock");
}, 30000);
it("keeps the old snapshot readable after an actual process exit between staging and activation", async () => {
  const { root, store, before } = await setup();
  const file = join(root, "input-plan.PRIVATE.json");
  await writeFile(file, JSON.stringify(plan), { mode: 0o600 });
  const module = new URL("./daily-rehearsal.ts", import.meta.url).href;
  const script = `import {DailyRehearsal} from ${JSON.stringify(module)}; import {readFile} from 'node:fs/promises'; const [root,file,head,at]=process.argv.slice(1); await new DailyRehearsal(root).commit(JSON.parse(await readFile(file,'utf8')),at,head,async()=>process.exit(77));`;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script, root, file, before.hash, at],
    { encoding: "utf8", timeout: 15000 },
  );
  expect(child.status, child.stderr).toBe(77);
  expect((await store.read()).hash).toBe(before.hash);
  expect((await readdir(join(root, "snapshots"))).length).toBe(2);
  const owner = JSON.parse(
    await readFile(join(root, "writer.lock/owner.json"), "utf8"),
  );
  expect(owner.pid).toBe(child.pid);
  await expect(store.commit(plan, at, before.hash)).rejects.toThrow("locked");
  // Recovery uses a fresh local name. Do not delete or auto-steal a crash lock.
  const recovery = await setup();
  const recovered = await recovery.store.commit(plan, at, recovery.before.hash);
  expect(recovered.state.catalog.history.total_released).toBe(1);
  expect((await store.read()).state.catalog.history.total_released).toBe(0);
}, 30000);
it("rejects production paths, reused names, pointer escapes, public extras and symlinked public files", async () => {
  await expect(
    DailyRehearsal.initialize(
      join(process.cwd(), "var/forbidden-daily"),
      catalog,
    ),
  ).rejects.toThrow("evidence or temporary");
  const { store, root, before } = await setup();
  await expect(DailyRehearsal.initialize(root, catalog)).rejects.toThrow();
  const pointer = await readlink(join(root, "current"));
  await rm(join(root, "current"));
  await symlink("../../anything", join(root, "current"));
  await expect(store.read()).rejects.toThrow("pointer");
  await rm(join(root, "current"));
  await symlink(pointer, join(root, "current"));
  await expect(
    store.commit(plan, at, before.hash, async (pub) => {
      await writeFile(join(pub, "leak.PRIVATE.json"), canonical(catalog));
    }),
  ).rejects.toThrow("Unexpected public data");
  expect((await store.read()).hash).toBe(before.hash);
  const clean = await setup();
  await expect(
    clean.store.commit(plan, at, clean.before.hash, async (pub) => {
      await rm(join(pub, "release.json"));
      await symlink(
        join(clean.root, ".LOCAL_DAILY"),
        join(pub, "release.json"),
      );
    }),
  ).rejects.toThrow("manifest mismatch");
}, 30000);
it("refuses missing or unrelated prior manifests once publication history exists", async () => {
  const { store, before } = await setup(),
    next = await store.commit(plan, at, before.hash);
  const c = next.state.catalog,
    id = catalog.entries[1].puzzle.puzzle_id;
  expect(() =>
    prepareDaily(c, id, "2026-10-18", "2026-10-18T00:00:01.000Z"),
  ).toThrow("Previous daily manifest required");
  const wrong = structuredClone(plan.manifest);
  wrong.active.sha256 = "a".repeat(64);
  wrong.active.payload_url = `/puzzles/${wrong.active.sha256}.json`;
  wrong.recent = [wrong.active];
  expect(() =>
    prepareDaily(c, id, "2026-10-18", "2026-10-18T00:00:01.000Z", wrong),
  ).toThrow("mismatch");
  expect(() =>
    prepareDaily(
      c,
      id,
      "2026-10-18",
      "2026-10-18T00:00:01.000Z",
      next.state.manifest!,
    ),
  ).toThrow("30");
}, 30000);

it("executes private plan/verify/rehearsal/inspect/replay CLI commands on an isolated synthetic workspace", async () => {
  const name = `test-${randomUUID()}`,
    project = fileURLToPath(new URL("../../", import.meta.url));
  const workspace = new PrivateStore(name),
    source = structuredClone(catalog);
  const paths = [
    workspace.dir,
    join(privateRoot, "daily", name),
    join(project, "evidence/daily-rehearsals", name),
  ];
  const cli = (...args: string[]) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        ["packages/puzzle-tools/daily-cli.ts", ...args],
        {
          cwd: project,
          encoding: "utf8",
          timeout: 15000,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    );
  try {
    await workspace.mutate((c) => {
      Object.assign(c, source);
    });
    expect(
      cli(
        "prepare",
        "--workspace",
        name,
        "--id",
        source.entries[0].puzzle.puzzle_id,
        "--edition",
        new Date().toISOString().slice(0, 10),
        "--name",
        name,
      ).status,
    ).toBe("private_prepared_only");
    expect(cli("verify", "--workspace", name, "--name", name).status).toBe(
      "private_plan_revalidated",
    );
    const result = cli(
      "rehearse",
      "--workspace",
      name,
      "--name",
      name,
      "--rehearsal",
      name,
    );
    expect(result.production_activated).toBe(false);
    expect(result.publication_count).toBe(1);
    expect(cli("inspect-rehearsal", "--rehearsal", name).hash).toBe(
      result.hash,
    );
    expect(
      cli(
        "commit-rehearsal",
        "--workspace",
        name,
        "--name",
        name,
        "--rehearsal",
        name,
        "--head",
        result.hash,
      ).unchanged,
    ).toBe(true);
    expect((await workspace.read()).history.total_released).toBe(0);
    const delayed = cli(
      "delay-rehearsal",
      "--rehearsal",
      name,
      "--head",
      result.hash,
      "--actor",
      "test",
      "--reason",
      "Synthetic delay only",
    );
    expect(delayed.release_status).toBe("delayed");
    const stopped = cli(
      "recall-rehearsal",
      "--rehearsal",
      name,
      "--head",
      delayed.hash,
      "--actor",
      "test",
      "--reason",
      "Synthetic withdrawal only",
      "--id",
      result.active_id ?? `onebox-${new Date().toISOString().slice(0, 10)}`,
    );
    expect(stopped.release_status).toBe("unavailable");
    expect(stopped.recalled_count).toBe(1);
    expect(cli("inspect-rehearsal", "--rehearsal", name).hash).toBe(
      stopped.hash,
    );
    expect(() =>
      cli(
        "refresh-rehearsal",
        "--workspace",
        name,
        "--rehearsal",
        name,
        "--head",
        stopped.hash,
        "--actor",
        "test",
        "--reason",
        "Unsynchronized source history",
      ),
    ).toThrow();
    expect((await workspace.read()).history.total_released).toBe(0);
    await workspace.mutate((c) => {
      c.entries[0].review!.notes += " edited";
    });
    expect(() => cli("verify", "--workspace", name, "--name", name)).toThrow();
    expect(() => cli("status", "--name", name)).toThrow();
    expect(() =>
      cli("inspect-rehearsal", "--rehearsal", "../escape"),
    ).toThrow();
  } finally {
    for (const path of paths) await rm(path, { recursive: true, force: true });
  }
}, 60000);
