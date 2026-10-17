import {
  mkdir,
  readFile,
  writeFile,
  rename,
  symlink,
  readlink,
  realpath,
  lstat,
  readdir,
  rm,
  open,
} from "node:fs/promises";
import { resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { canonical, validatePuzzle } from "../game-core/index.ts";
import {
  validateManifest,
  validatePublishedPuzzle,
  recallDaily,
  delayDaily,
  dailyEntry,
  validateArchive,
  type PublicArchive,
  type ReleaseManifest,
} from "../game-core/release.ts";
import {
  validateCatalog,
  replaceHistory,
  label,
  type Catalog,
} from "./curation.ts";
import { digest } from "./generator.ts";
import { validateDailyPlan, type DailyPlan } from "./daily.ts";

const marker = "ONEBOX LOCAL DAILY REHEARSAL v1\n";
const evidence = fileURLToPath(new URL("../../evidence/", import.meta.url));
const hashPattern = /^[a-f0-9]{64}$/;
function allowedRoot(root: string, temp: string) {
  const project = resolve(evidence, "..");
  const inProject = root === project || root.startsWith(project + sep);
  return (
    root.startsWith(resolve(evidence) + sep) ||
    (!inProject && root.startsWith(temp + sep))
  );
}
interface Snapshot {
  format_version: 1;
  local_only: true;
  catalog: Catalog;
  manifest: ReleaseManifest | null;
  payloads: Record<string, string>;
  plans: Record<string, string>;
  sources: Record<string, string>;
  parent: string | null;
  controls?: Control[];
  archive_version?: 1;
}
function archiveData(s: Snapshot) {
  const candidates = new Map(
    s.catalog.entries.map((e) => [e.puzzle.puzzle_id, e.puzzle]),
  );
  const payloads: Record<string, string> = {};
  const entries = Object.entries(s.sources)
    .map(([id, source]) => {
      const original = candidates.get(source);
      if (!original) throw Error("Missing published source");
      const puzzle = validatePuzzle({
        ...original,
        puzzle_id: id,
        purpose: "production_daily",
      });
      const hash = digest(puzzle),
        entry = dailyEntry(puzzle, hash);
      if (!s.manifest?.recalled_ids.includes(id))
        payloads[hash] = canonical(puzzle);
      return entry;
    })
    .sort((a, b) => b.edition_utc!.localeCompare(a.edition_utc!));
  const archive: PublicArchive = { archive_version: 1, entries };
  return { archive, payloads };
}
interface Control {
  action: "recall" | "delayed" | "refresh_catalog";
  puzzle_id: string | null;
  at: string;
  actor: string;
  reason: string;
}
function control(value: Control): Control {
  if (
    Object.keys(value).sort().join() !== "action,actor,at,puzzle_id,reason" ||
    !["recall", "delayed", "refresh_catalog"].includes(value.action) ||
    (value.puzzle_id !== null &&
      !/^onebox-\d{4}-\d{2}-\d{2}$/.test(value.puzzle_id)) ||
    typeof value.reason !== "string" ||
    !value.reason.trim() ||
    value.reason.length > 280 ||
    new Date(value.at).toISOString() !== value.at
  )
    throw Error("Invalid rehearsal control");
  label(value.actor);
  return structuredClone(value);
}
async function durable(file: string, data: string) {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

// This store is deliberately confined to local evidence or OS temporary space.
// It cannot activate a production release or update the real curation workspace.
export class DailyRehearsal {
  readonly root: string;
  constructor(root: string) {
    this.root = root;
  }
  private async location() {
    const root = resolve(this.root);
    const temp = await realpath(tmpdir());
    if (!allowedRoot(root, temp))
      throw Error("Daily rehearsal must remain in evidence or temporary space");
    const markerFile = resolve(root, ".LOCAL_DAILY");
    if (
      (await realpath(root)) !== root ||
      !(await lstat(markerFile)).isFile() ||
      (await lstat(markerFile)).size !== Buffer.byteLength(marker) ||
      (await readFile(markerFile, "utf8")) !== marker
    )
      throw Error("Local rehearsal marker and real directory required");
    return root;
  }
  static async initialize(root: string, raw: Catalog) {
    const catalog = validateCatalog(raw);
    if (catalog.history.total_released)
      throw Error(
        "Rehearsal initialization requires empty publication history",
      );
    const temp = await realpath(tmpdir());
    if (!allowedRoot(resolve(root), temp))
      throw Error("Daily rehearsal must remain in evidence or temporary space");
    const parent = await realpath(resolve(root, ".."));
    if (parent !== resolve(root, ".."))
      throw Error("Rehearsal parent must not use symlinks");
    await mkdir(root, { mode: 0o700 });
    await durable(resolve(root, ".LOCAL_DAILY"), marker);
    await mkdir(resolve(root, "snapshots"), { mode: 0o700 });
    const store = new DailyRehearsal(root);
    const saved = await store.stage({
      format_version: 1,
      local_only: true,
      catalog,
      manifest: null,
      payloads: {},
      plans: {},
      sources: {},
      parent: null,
    });
    await store.activate(saved.hash);
    return store;
  }
  private async validate(raw: unknown): Promise<Snapshot> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw Error("Invalid rehearsal snapshot");
    const s = raw as Snapshot;
    if (
      Object.keys(s)
        .filter((k) => k !== "controls" && k !== "archive_version")
        .sort()
        .join() !==
        "catalog,format_version,local_only,manifest,parent,payloads,plans,sources" ||
      s.format_version !== 1 ||
      s.local_only !== true ||
      (s.archive_version !== undefined && s.archive_version !== 1) ||
      (s.parent !== null && !hashPattern.test(s.parent))
    )
      throw Error("Invalid rehearsal fields");
    if (s.controls !== undefined) {
      if (!Array.isArray(s.controls) || s.controls.length > 2000)
        throw Error("Invalid control log");
      s.controls.forEach(control);
    }
    const c = validateCatalog(s.catalog);
    for (const v of [s.payloads, s.plans, s.sources])
      if (!v || typeof v !== "object" || Array.isArray(v))
        throw Error("Invalid rehearsal index");
    if (
      Object.keys(s.plans).length !== c.history.total_released ||
      canonical(Object.keys(s.plans).sort()) !==
        canonical(Object.keys(s.sources).sort())
    )
      throw Error("Invalid rehearsal publication history");
    for (const id of Object.keys(s.plans)) {
      if (
        !/^onebox-\d{4}-\d{2}-\d{2}$/.test(id) ||
        !hashPattern.test(s.plans[id]) ||
        !c.entries.some((e) => e.puzzle.puzzle_id === s.sources[id])
      )
        throw Error("Invalid rehearsal source identity");
    }
    if (s.manifest === null) {
      if (c.history.total_released || Object.keys(s.payloads).length)
        throw Error("Missing rehearsal manifest");
    } else {
      const m = validateManifest(s.manifest);
      const derived = s.archive_version ? archiveData(s) : null;
      if (!!m.archive !== !!derived) throw Error("Archive format mismatch");
      if (derived) {
        validateArchive(derived.archive, m);
        if (
          digest(derived.archive) !== m.archive!.sha256 ||
          canonical(derived.payloads) !== canonical(s.payloads)
        )
          throw Error("Archive/source/payload mismatch");
      }
      const available = (derived?.archive.entries ?? m.recent).filter(
        (e) => !m.recalled_ids.includes(e.puzzle_id),
      );
      if (
        m.stage !== "daily" ||
        Object.keys(s.payloads).length !== available.length
      )
        throw Error("Invalid rehearsal manifest");
      for (const e of available) {
        const value = s.payloads[e.sha256];
        if (typeof value !== "string" || Buffer.byteLength(value) > 10000)
          throw Error("Missing bounded rehearsal payload");
        const p = await validatePublishedPuzzle(JSON.parse(value), e);
        if (
          canonical(p) !== value ||
          !(derived
            ? derived.archive.entries.some(
                (h) => h.puzzle_id === e.puzzle_id && h.sha256 === e.sha256,
              )
            : c.history.items.some(
                (h) =>
                  h.puzzle.puzzle_id === e.puzzle_id && h.hash === e.sha256,
              )) ||
          !s.plans[e.puzzle_id]
        )
          throw Error("Rehearsal history/payload mismatch");
      }
      if (
        m.recalled_ids.some((id) => !s.plans[id]) ||
        c.history.items.some(
          (h) =>
            !m.recalled_ids.includes(h.puzzle.puzzle_id) &&
            !available.some(
              (e) => e.puzzle_id === h.puzzle.puzzle_id && e.sha256 === h.hash,
            ),
        )
      )
        throw Error("Rehearsal history is missing available editions");
      if (
        m.release_status !== "unavailable" &&
        (derived
          ? available[0]?.puzzle_id
          : c.history.items
              .filter((h) => !m.recalled_ids.includes(h.puzzle.puzzle_id))
              .at(-1)?.puzzle.puzzle_id) !== m.active.puzzle_id
      )
        throw Error("Rehearsal active history mismatch");
    }
    return structuredClone(s);
  }
  private async snapshot(hash: string) {
    if (!hashPattern.test(hash)) throw Error("Invalid rehearsal hash");
    const root = await this.location(),
      dir = resolve(root, "snapshots", hash);
    if ((await realpath(dir)) !== dir)
      throw Error("Snapshot must not use symlinks");
    const file = resolve(dir, "snapshot.PRIVATE.json"),
      info = await lstat(file);
    if (!info.isFile() || info.size > 10000000)
      throw Error("Invalid bounded snapshot file");
    const state = await this.validate(JSON.parse(await readFile(file, "utf8")));
    if (digest(state) !== hash) throw Error("Snapshot integrity mismatch");
    const publicRoot = resolve(dir, "public");
    if ((await realpath(publicRoot)) !== publicRoot)
      throw Error("Public data must not use symlinks");
    const expected = state.manifest
      ? [
          ...(state.archive_version ? ["archives"] : []),
          "puzzles",
          "release.json",
        ]
      : [];
    if (canonical((await readdir(publicRoot)).sort()) !== canonical(expected))
      throw Error("Unexpected public data");
    if (state.manifest) {
      if (state.archive_version) {
        const archive = archiveData(state).archive,
          dir = resolve(publicRoot, "archives"),
          hash = state.manifest.archive!.sha256;
        if (
          (await realpath(dir)) !== dir ||
          canonical(await readdir(dir)) !== canonical([`${hash}.json`])
        )
          throw Error("Unexpected public archive");
        const path = resolve(dir, `${hash}.json`),
          info = await lstat(path);
        if (
          !info.isFile() ||
          info.size !== Buffer.byteLength(canonical(archive)) ||
          (await readFile(path, "utf8")) !== canonical(archive)
        )
          throw Error("Public archive mismatch");
      }
      const manifestFile = resolve(publicRoot, "release.json"),
        manifestInfo = await lstat(manifestFile);
      if (
        !manifestInfo.isFile() ||
        manifestInfo.size !== Buffer.byteLength(canonical(state.manifest)) ||
        (await readFile(manifestFile, "utf8")) !== canonical(state.manifest)
      )
        throw Error("Public manifest mismatch");
      const payloadDir = resolve(publicRoot, "puzzles");
      if ((await realpath(payloadDir)) !== payloadDir)
        throw Error("Payload directory must not use symlinks");
      if (
        canonical((await readdir(payloadDir)).sort()) !==
        canonical(
          Object.keys(state.payloads)
            .map((h) => `${h}.json`)
            .sort(),
        )
      )
        throw Error("Unexpected public payload");
      for (const [h, data] of Object.entries(state.payloads)) {
        const p = resolve(payloadDir, `${h}.json`);
        const info = await lstat(p);
        if (
          !info.isFile() ||
          info.size !== Buffer.byteLength(data) ||
          (await readFile(p, "utf8")) !== data
        )
          throw Error("Public payload mismatch");
      }
    }
    return {
      hash,
      state,
      publicRoot,
      archive:
        state.archive_version && state.manifest
          ? archiveData(state).archive
          : undefined,
    };
  }
  async read() {
    const root = await this.location(),
      target = await readlink(resolve(root, "current"));
    if (!/^snapshots\/[a-f0-9]{64}$/.test(target))
      throw Error("Invalid rehearsal current pointer");
    return this.snapshot(target.slice(10));
  }
  private async stage(state: Snapshot) {
    await this.validate(state);
    const root = await this.location(),
      hash = digest(state),
      dir = resolve(root, "snapshots", hash);
    try {
      return await this.snapshot(hash);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    // An incomplete directory is never current. Keep it for inspection on failure.
    await mkdir(dir, { mode: 0o700 });
    await durable(resolve(dir, "snapshot.PRIVATE.json"), canonical(state));
    const pub = resolve(dir, "public");
    await mkdir(pub, { mode: 0o700 });
    if (state.manifest) {
      if (state.archive_version) {
        await mkdir(resolve(pub, "archives"), { mode: 0o700 });
        await durable(
          resolve(pub, "archives", `${state.manifest.archive!.sha256}.json`),
          canonical(archiveData(state).archive),
        );
      }
      await mkdir(resolve(pub, "puzzles"), { mode: 0o700 });
      for (const [hash, data] of Object.entries(state.payloads))
        await durable(resolve(pub, "puzzles", `${hash}.json`), data);
      await durable(resolve(pub, "release.json"), canonical(state.manifest));
    }
    return this.snapshot(hash);
  }
  private async activate(hash: string) {
    const root = await this.location(),
      next = resolve(root, `next-${randomUUID()}`);
    await symlink(`snapshots/${hash}`, next);
    try {
      await rename(next, resolve(root, "current"));
    } finally {
      await rm(next, { force: true });
    }
  }
  private async transaction<T>(
    at: string | (() => string),
    action: (
      current: Awaited<ReturnType<DailyRehearsal["read"]>>,
      when: string,
      clock: () => string,
    ) => Promise<T>,
  ) {
    const clock = typeof at === "function" ? at : () => at,
      when = clock();
    if (typeof when !== "string" || new Date(when).toISOString() !== when)
      throw Error("Invalid rehearsal time");
    const root = await this.location(),
      lock = resolve(root, "writer.lock");
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        throw Error("Rehearsal writer locked; inspect it before recovery");
      throw e;
    }
    try {
      await durable(
        resolve(lock, "owner.json"),
        JSON.stringify({ pid: process.pid, at: when }),
      );
      const current = await this.read();
      if (
        when < (current.state.manifest?.published_at ?? "") ||
        when < (current.state.controls?.at(-1)?.at ?? "")
      )
        throw Error("Rehearsal time must not move backwards");
      return await action(current, when, clock);
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
  private head(current: { hash: string }, expected: string) {
    if (current.hash !== expected)
      throw Error("Rehearsal head changed; reload before committing");
  }
  private async switchState(
    current: Awaited<ReturnType<DailyRehearsal["read"]>>,
    state: Snapshot,
    when: string,
    clock: () => string,
    verify?: (publicRoot: string) => Promise<void>,
  ) {
    const data = archiveData(state);
    const archiveHash = digest(data.archive);
    if (
      state.manifest?.archive &&
      state.manifest.archive.sha256 !== archiveHash
    )
      throw Error("Prepared archive mismatch");
    const staged = await this.stage({
      ...state,
      archive_version: 1,
      payloads: data.payloads,
      manifest: state.manifest
        ? validateManifest({
            ...state.manifest,
            archive: {
              url: `/archives/${archiveHash}.json`,
              sha256: archiveHash,
              count: data.archive.entries.length,
            },
          })
        : null,
    });
    if (verify) await verify(staged.publicRoot);
    await this.snapshot(staged.hash);
    if ((await this.read()).hash !== current.hash)
      throw Error("Rehearsal head changed during verification");
    if (
      new Date(clock()).toISOString().slice(0, 10) !==
      new Date(when).toISOString().slice(0, 10)
    )
      throw Error("UTC day changed during verification; prepare a new plan");
    await this.activate(staged.hash);
    return { ...staged, unchanged: false };
  }
  async commit(
    raw: unknown,
    at: string | (() => string),
    expectedHead: string,
    verify?: (publicRoot: string) => Promise<void>,
  ) {
    return this.transaction(at, async (current, when, clock) => {
      const plan = raw as DailyPlan,
        manifest = validateManifest(plan?.manifest),
        id = manifest.active.puzzle_id;
      if (current.state.plans[id]) {
        if (current.state.plans[id] !== digest(raw))
          throw Error("Published rehearsal ID is immutable");
        return { ...current, unchanged: true };
      }
      this.head(current, expectedHead);
      const checked = validateDailyPlan(
        raw,
        current.state.catalog,
        when,
        current.state.manifest ?? undefined,
        current.archive,
      );
      if (Object.values(current.state.sources).includes(checked.source_id))
        throw Error("Rehearsal source was already published");
      const catalog = structuredClone(current.state.catalog),
        puzzle = validatePuzzle(JSON.parse(checked.payload_json));
      const activatedManifest = validateManifest({
        ...checked.manifest,
        published_at: when,
      });
      replaceHistory(
        catalog,
        {
          format_version: 1,
          total_released: catalog.history.total_released + 1,
          items: [
            ...catalog.history.items,
            {
              sequence: catalog.history.total_released + 1,
              published_at: when,
              puzzle,
              hash: digest(puzzle),
              solver_nodes: checked.solver_nodes,
            },
          ].slice(-180),
        },
        "daily-rehearsal",
        when,
      );
      catalog.revision++;
      const payloads: Record<string, string> = {};
      for (const e of checked.manifest.recent)
        if (!checked.manifest.recalled_ids.includes(e.puzzle_id))
          payloads[e.sha256] =
            e.puzzle_id === id
              ? checked.payload_json
              : current.state.payloads[e.sha256];
      return this.switchState(
        current,
        {
          ...current.state,
          catalog,
          manifest: activatedManifest,
          payloads,
          plans: { ...current.state.plans, [id]: digest(checked) },
          sources: { ...current.state.sources, [id]: checked.source_id },
          parent: current.hash,
        },
        when,
        clock,
        verify,
      );
    });
  }
  async refreshCatalog(
    raw: Catalog,
    at: string | (() => string),
    expectedHead: string,
    actor: string,
    reason: string,
  ) {
    return this.transaction(at, async (current, when, clock) => {
      this.head(current, expectedHead);
      const catalog = validateCatalog(raw),
        old = current.state.catalog;
      if (
        catalog.revision <= old.revision ||
        canonical(catalog.history) !== canonical(old.history) ||
        old.history_events.some(
          (e, i) => canonical(e) !== canonical(catalog.history_events[i]),
        )
      )
        throw Error(
          "Catalog refresh must preserve committed history and advance revision",
        );
      for (const oldEntry of old.entries) {
        const next = catalog.entries.find(
          (e) => e.puzzle.puzzle_id === oldEntry.puzzle.puzzle_id,
        );
        if (
          !next ||
          canonical(next.puzzle) !== canonical(oldEntry.puzzle) ||
          oldEntry.events.some(
            (e, i) => canonical(e) !== canonical(next.events[i]),
          ) ||
          oldEntry.trials.some(
            (t, i) => canonical(t) !== canonical(next.trials[i]),
          )
        )
          throw Error(
            "Catalog refresh must preserve candidate identity and prior evidence",
          );
      }
      const record = control({
        action: "refresh_catalog",
        puzzle_id: null,
        at: when,
        actor,
        reason,
      });
      return this.switchState(
        current,
        {
          ...current.state,
          catalog,
          controls: [...(current.state.controls ?? []), record],
          parent: current.hash,
        },
        when,
        clock,
      );
    });
  }
  async recall(
    id: string,
    at: string | (() => string),
    expectedHead: string,
    actor: string,
    reason: string,
    verify?: (publicRoot: string) => Promise<void>,
  ) {
    return this.changeAvailability(
      "recall",
      id,
      at,
      expectedHead,
      actor,
      reason,
      verify,
    );
  }
  async markDelayed(
    at: string | (() => string),
    expectedHead: string,
    actor: string,
    reason: string,
    verify?: (publicRoot: string) => Promise<void>,
  ) {
    return this.changeAvailability(
      "delayed",
      null,
      at,
      expectedHead,
      actor,
      reason,
      verify,
    );
  }
  private async changeAvailability(
    action: "recall" | "delayed",
    id: string | null,
    at: string | (() => string),
    expectedHead: string,
    actor: string,
    reason: string,
    verify?: (publicRoot: string) => Promise<void>,
  ) {
    return this.transaction(at, async (current, when, clock) => {
      const record = control({
        action,
        puzzle_id: id,
        at: when,
        actor,
        reason,
      });
      if (!current.state.manifest) throw Error("No committed daily manifest");
      const manifest =
        action === "recall"
          ? recallDaily(current.state.manifest, id!, when, current.archive)
          : delayDaily(current.state.manifest, when);
      if (canonical(manifest) === canonical(current.state.manifest))
        return { ...current, unchanged: true };
      this.head(current, expectedHead);
      const payloads: Record<string, string> = {};
      for (const e of manifest.recent)
        if (!manifest.recalled_ids.includes(e.puzzle_id))
          payloads[e.sha256] = current.state.payloads[e.sha256];
      return this.switchState(
        current,
        {
          ...current.state,
          manifest,
          payloads,
          controls: [...(current.state.controls ?? []), record],
          parent: current.hash,
        },
        when,
        clock,
        verify,
      );
    });
  }
}
