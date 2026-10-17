import {
  readFile,
  readdir,
  mkdir,
  writeFile,
  realpath,
  lstat,
  symlink,
  rename,
  rm,
  copyFile,
  open,
} from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import {
  canonical,
  validatePuzzle,
  complete,
} from "../packages/game-core/index.ts";
import { validateCatalog } from "../packages/puzzle-tools/curation.ts";
import { geometryKey } from "../packages/puzzle-tools/geometry.ts";
import { verify, digest } from "../packages/puzzle-tools/generator.ts";
import {
  validateManifest,
  validatePublishedPuzzle,
  validatePublishedArchive,
  dailyEntry,
  nextUtcUpdate,
  recallDaily,
} from "../packages/game-core/release.ts";
import { artifactDigest } from "./artifact.mjs";

export const policy = "machine-verified-human-trial-waived-20261017";
export function needsDailyPublication(plan, at) {
  const today = at.slice(0, 10);
  if (plan.ledger.records.at(-1)?.published_at.slice(0, 10) === today)
    return false;
  // A control/recall timestamp is not evidence that today's puzzle was published.
  return !(
    plan.remaining === 0 && plan.manifest.published_at.slice(0, 10) === today
  );
}
const project = resolve(import.meta.dirname, "..");
const day = (at) => {
  if (new Date(at).toISOString() !== at) throw Error("Invalid clock");
  return at.slice(0, 10);
};
const same = (a, b) => canonical(a) === canonical(b);
async function regular(root, file, limit = 5000000) {
  const path = resolve(root, file),
    info = await lstat(path);
  if (
    !info.isFile() ||
    info.size > limit ||
    (await realpath(path)) !== path ||
    !path.startsWith(root + sep)
  )
    throw Error("Unsafe bounded release file");
  return readFile(path);
}
export function checkLedger(value, at) {
  if (
    !value ||
    value.version !== 1 ||
    value.policy !== policy ||
    !Array.isArray(value.records) ||
    value.records.length < 1 ||
    value.records.length > 10000 ||
    !Array.isArray(value.recalled_ids)
  )
    throw Error("Invalid production ledger");
  const ids = new Set(),
    sources = new Set(),
    geometries = new Set();
  for (const [i, r] of value.records.entries()) {
    const p = validatePuzzle(r.puzzle);
    if (
      p.purpose !== "production_daily" ||
      p.puzzle_id !== `onebox-${day(r.published_at)}` ||
      r.published_at > at ||
      r.payload_hash !== digest(p) ||
      r.source_hash !==
        digest({
          ...p,
          puzzle_id: r.source_id,
          purpose: "design_verification_only",
        }) ||
      !/^candidate-[a-f0-9]{12}$/.test(r.source_id) ||
      !/^[a-f0-9]{64}$/.test(r.source_hash) ||
      r.verification !== "js+python-exact+python-dfs" ||
      ids.has(p.puzzle_id) ||
      sources.has(r.source_id) ||
      geometries.has(geometryKey(p)) ||
      (i &&
        value.records[i - 1].published_at.slice(0, 10) >=
          r.published_at.slice(0, 10))
    )
      throw Error("Production history integrity mismatch");
    ids.add(p.puzzle_id);
    sources.add(r.source_id);
    geometries.add(geometryKey(p));
  }
  if (
    new Set(value.recalled_ids).size !== value.recalled_ids.length ||
    value.recalled_ids.some((id) => !ids.has(id))
  )
    throw Error("Unknown recalled publication");
  return structuredClone(value);
}
export function machinePool(raw, ledger, practice, at) {
  const c = validateCatalog(raw),
    used = new Set(ledger?.records.map((r) => r.source_id) ?? []),
    prior = new Set(ledger?.records.map((r) => geometryKey(r.puzzle)) ?? []);
  prior.add(geometryKey(practice));
  const eligible = c.entries.filter((e) => e.stage !== "rejected"),
    counts = new Map();
  for (const e of eligible)
    counts.set(e.geometry_key, (counts.get(e.geometry_key) ?? 0) + 1);
  const deadline = performance.now() + 10000,
    pool = [];
  for (const e of eligible) {
    if (
      used.has(e.puzzle.puzzle_id) ||
      counts.get(e.geometry_key) !== 1 ||
      prior.has(e.geometry_key)
    )
      continue;
    const remaining = Math.floor(deadline - performance.now());
    if (remaining < 1)
      throw Error("Machine stock verification budget exhausted");
    const v = verify(e.puzzle, 100000, Math.min(1500, remaining));
    if (
      v.status === "unique" &&
      v.hash === e.verification.hash &&
      complete(e.puzzle, e.construction)
    )
      pool.push(e);
  }
  return pool.sort(
    (a, b) =>
      a.verification.nodes - b.verification.nodes ||
      a.puzzle.puzzle_id.localeCompare(b.puzzle.puzzle_id),
  );
}
function independent(puzzle) {
  const r = JSON.parse(
    execFileSync("python3", ["-E", "verification/check_candidates.py", "-"], {
      cwd: project,
      input: JSON.stringify([puzzle]),
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 100000,
      stdio: ["pipe", "pipe", "pipe"],
    }),
  );
  if (
    r.checked !== 1 ||
    r.reports[0].hash !== digest(puzzle) ||
    r.reports[0].exact_cover_count !== 1 ||
    r.reports[0].independent_dfs_count !== 1
  )
    throw Error("Independent production verification failed");
}
export function planProduction(raw, prior, practice, at, options = {}) {
  const c = validateCatalog(raw);
  day(at);
  const ledger = prior
    ? checkLedger(prior, at)
    : { version: 1, policy, records: [], recalled_ids: [] };
  for (const r of ledger.records) {
    const source = c.entries.find((e) => e.puzzle.puzzle_id === r.source_id);
    if (!source || digest(source.puzzle) !== r.source_hash)
      throw Error("Published source was changed or removed");
  }
  const pool = machinePool(c, ledger, practice, at),
    last = ledger.records.at(-1);
  if (options.recall) {
    if (!ledger.records.some((r) => r.puzzle.puzzle_id === options.recall))
      throw Error("Unknown recalled publication");
    if (!ledger.recalled_ids.includes(options.recall))
      ledger.recalled_ids.push(options.recall);
  } else if (last?.published_at.slice(0, 10) !== day(at)) {
    if (!last && pool.length < 30)
      throw Error(
        "30 machine-verified distinct candidates required for launch",
      );
    if (pool.length) {
      const source = pool[0],
        puzzle = validatePuzzle({
          ...structuredClone(source.puzzle),
          puzzle_id: `onebox-${day(at)}`,
          purpose: "production_daily",
        });
      independent(puzzle);
      ledger.records.push({
        published_at: at,
        source_id: source.puzzle.puzzle_id,
        source_hash: digest(source.puzzle),
        puzzle,
        payload_hash: digest(puzzle),
        solver_nodes: source.verification.nodes,
        verification: "js+python-exact+python-dfs",
      });
    } else if (!last) throw Error("No verified candidate");
  }
  checkLedger(ledger, at);
  const entries = ledger.records
      .map((r) => dailyEntry(r.puzzle, r.payload_hash))
      .reverse(),
    available = entries.filter(
      (e) => !ledger.recalled_ids.includes(e.puzzle_id),
    ),
    active = available[0] ?? entries[0];
  const archive = { archive_version: 1, entries },
    hash = digest(archive);
  const manifest = validateManifest({
    manifest_version: 1,
    stage: "daily",
    published_at: at,
    release_status: !available.length
      ? "unavailable"
      : active.edition_utc === day(at)
        ? "ready"
        : "delayed",
    active,
    next_update_at: nextUtcUpdate(at),
    recent: available.length ? available.slice(0, 180) : [active],
    recalled_ids: ledger.recalled_ids,
    archive: {
      url: `/archives/${hash}.json`,
      sha256: hash,
      count: entries.length,
    },
  });
  return {
    ledger,
    manifest,
    archive,
    source_catalog_hash: digest(c),
    remaining:
      pool.length - (ledger.records.length - (prior?.records.length ?? 0)),
  };
}
const escape = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
export function productionHtml(source, locale, entry, fixed, cover, origin) {
  const practice = entry.purpose === "practice",
    path = `/${locale}/${fixed ? `p/${entry.slug}/` : ""}`;
  const title =
    locale === "ja"
      ? "ONEBOX — 4つの形を、ひとつの箱に。"
      : "ONEBOX — Four pieces. One perfect fit.";
  const description =
    locale === "ja"
      ? practice
        ? "登録不要の固定1問。4つの形をひとつの箱へ。"
        : `登録不要の毎日パズル。4つの形をひとつの箱へ。${fixed ? entry.edition_utc + "の問題。" : ""}`
      : practice
        ? "No sign-up. A fixed practice puzzle."
        : "No sign-up. A shared daily puzzle. Four pieces. One perfect fit.";
  let html = source
    .replace('<html lang="ja">', `<html lang="${locale}">`)
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(
      /<meta name="description"[^>]*>/,
      `<meta name="description" content="${escape(description)}"/>`,
    );
  const alt = (lang) => `${origin}/${lang}/${fixed ? `p/${entry.slug}/` : ""}`;
  return html.replace(
    "</head>",
    `<meta name="robots" content="index,follow"/><link rel="canonical" href="${origin + path}"/><link rel="alternate" hreflang="ja" href="${alt("ja")}"/><link rel="alternate" hreflang="en" href="${alt("en")}"/><link rel="alternate" hreflang="x-default" href="${alt("ja")}"/><meta property="og:type" content="website"/><meta property="og:title" content="${title}"/><meta property="og:description" content="${escape(description)}"/><meta property="og:url" content="${origin + path}"/><meta property="og:image" content="${origin}/assets/${cover}"/><meta property="og:image:width" content="1200"/><meta property="og:image:height" content="630"/></head>`,
  );
}
export async function checkProductionSite(input) {
  const root = await realpath(input),
    manifest = validateManifest(
      JSON.parse(await regular(root, "release.json", 1000000)),
    );
  if (manifest.stage !== "daily" || !manifest.archive)
    throw Error("Production daily manifest required");
  const archive = await validatePublishedArchive(
    JSON.parse(await regular(root, manifest.archive.url.slice(1))),
    manifest,
  );
  const practice = validateManifest(
    JSON.parse(await regular(root, "practice-release.json")),
  );
  if (practice.stage !== "playtest")
    throw Error("Original practice release required");
  const payloads = [
    ...archive.entries.filter(
      (e) => !manifest.recalled_ids.includes(e.puzzle_id),
    ),
    practice.active,
  ];
  const allowed = new Set([
    "index.html",
    "ja/index.html",
    "en/index.html",
    "release.json",
    "practice-release.json",
    manifest.archive.url.slice(1),
  ]);
  for (const e of [...archive.entries, practice.active])
    for (const locale of ["ja", "en"])
      allowed.add(`${locale}/p/${e.slug}/index.html`);
  for (const e of payloads) {
    const path = e.payload_url.slice(1),
      bytes = await regular(root, path, 10000);
    allowed.add(path);
    const p = await validatePublishedPuzzle(JSON.parse(bytes), e);
    if (bytes.toString() !== canonical(p))
      throw Error("Noncanonical public payload");
  }
  let gzip = 0;
  async function walk(dir, prefix = "") {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const relative = prefix + e.name;
      if (e.isDirectory()) {
        await walk(resolve(dir, e.name), relative + "/");
        continue;
      }
      if (!e.isFile()) throw Error("Nonregular public file");
      const bytes = await regular(root, relative);
      if (
        !relative.endsWith(".png") &&
        /PRIVATE|sample_solution|verified_fixture_batch|negative_test_do_not_publish|BEGIN PRIVATE KEY/.test(
          bytes.toString(),
        )
      )
        throw Error("Private content in public release");
      if (/^assets\/[\w.-]+\.(js|css)$/.test(relative)) {
        gzip += gzipSync(bytes).length;
        if (
          /PRIVATE|sample_solution|verified_fixture_batch|negative_test_do_not_publish|BEGIN PRIVATE KEY|design_verification_only.{0,30}fixture-/.test(
            bytes.toString(),
          )
        )
          throw Error("Private content in bundle");
      } else if (/^assets\/onebox-cover-[a-f0-9]{12}\.png$/.test(relative)) {
        const hash = createHash("sha256")
          .update(bytes)
          .digest("hex")
          .slice(0, 12);
        if (
          !relative.endsWith(`${hash}.png`) ||
          bytes.length > 100000 ||
          bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
          bytes.readUInt32BE(16) !== 1200 ||
          bytes.readUInt32BE(20) !== 630
        )
          throw Error("Invalid public cover");
      } else if (!allowed.has(relative)) throw Error("Unlisted public file");
      else allowed.delete(relative);
    }
  }
  await walk(root);
  if (allowed.size || gzip > 250 * 1024)
    throw Error("Missing public file or asset budget");
  return {
    manifest,
    archive,
    practice,
    gzip,
    digest: await artifactDigest(root),
  };
}
async function output(root, path, data) {
  const file = resolve(root, path);
  await mkdir(dirname(file), { recursive: true });
  const handle = await open(file, "wx");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function stageProduction({
  base,
  shell,
  practiceRoot,
  catalog,
  at,
  options = {},
}) {
  base = resolve(base);
  shell = await realpath(shell);
  practiceRoot = await realpath(practiceRoot);
  const current = await realpath(resolve(base, "var/current"));
  let prior;
  const old = JSON.parse(
    await readFile(resolve(current, "release.json"), "utf8"),
  );
  if (old.stage === "daily") {
    if (
      !current.startsWith(resolve(base, "var/production/snapshots") + sep) ||
      !current.endsWith("/public")
    )
      throw Error("Unknown production state");
    const oldState = JSON.parse(
      await regular(dirname(current), "state.PRIVATE.json", 10000000),
    );
    const checked = await checkProductionSite(current);
    if (
      checked.digest !== oldState.public_digest ||
      !same(oldState.plan.manifest, checked.manifest)
    )
      throw Error("Current production integrity mismatch");
    prior = checkLedger(oldState.plan.ledger, at);
  }
  const practice = validateManifest(
    JSON.parse(await regular(practiceRoot, "release.json")),
  );
  if (practice.stage !== "playtest")
    throw Error("Verified original practice required");
  const p = await validatePublishedPuzzle(
    JSON.parse(
      await regular(practiceRoot, practice.active.payload_url.slice(1)),
    ),
    practice.active,
  );
  if (
    (await regular(shell, ".PRODUCTION_SHELL")).toString() !==
    "ONEBOX production shell v1\n"
  )
    throw Error("Production shell required");
  const plan = planProduction(catalog, prior, p, at, options);
  const snapshots = resolve(base, "var/production/snapshots");
  await mkdir(snapshots, { recursive: true, mode: 0o700 });
  if ((await realpath(snapshots)) !== snapshots)
    throw Error("Symlinked production parent");
  const temp = resolve(snapshots, "staged-" + randomUUID());
  await mkdir(temp, { mode: 0o700 });
  const pub = resolve(temp, "public");
  await mkdir(pub);
  // Staging failures retain their private directory for inspection, never switch current.
  const source = (await regular(shell, "index.html")).toString(),
    assets = await readdir(resolve(shell, "assets"));
  const cover = assets.find((s) => /^onebox-cover-[a-f0-9]{12}\.png$/.test(s));
  if (!cover) throw Error("Generic cover missing");
  for (const name of assets)
    await output(pub, "assets/" + name, await regular(shell, "assets/" + name));
  await output(pub, "release.json", canonical(plan.manifest));
  await output(pub, "practice-release.json", canonical(practice));
  await output(pub, practice.active.payload_url.slice(1), canonical(p));
  await output(
    pub,
    plan.manifest.archive.url.slice(1),
    canonical(plan.archive),
  );
  for (const r of plan.ledger.records)
    if (!plan.ledger.recalled_ids.includes(r.puzzle.puzzle_id))
      await output(pub, `puzzles/${r.payload_hash}.json`, canonical(r.puzzle));
  const origin = "https://onebox.formflow-ops.com";
  for (const locale of ["ja", "en"]) {
    const top = productionHtml(
      source,
      locale,
      plan.manifest.active,
      false,
      cover,
      origin,
    );
    await output(pub, `${locale}/index.html`, top);
    if (locale === "ja") await output(pub, "index.html", top);
    for (const entry of [...plan.archive.entries, practice.active])
      await output(
        pub,
        `${locale}/p/${entry.slug}/index.html`,
        productionHtml(source, locale, entry, true, cover, origin),
      );
  }
  const checked = await checkProductionSite(pub),
    state = {
      format_version: 1,
      expected_previous: current,
      public_digest: checked.digest,
      plan,
    };
  const hash = digest(state);
  const stateFile = await open(
    resolve(temp, "state.PRIVATE.json"),
    "wx",
    0o600,
  );
  try {
    await stateFile.writeFile(canonical(state));
    await stateFile.sync();
  } finally {
    await stateFile.close();
  }
  const final = resolve(snapshots, hash);
  await rename(temp, final);
  return { hash, dir: final, publicRoot: resolve(final, "public"), state };
}
export async function activateProduction(base, staged, catalog, now) {
  const at = now();
  day(at);
  if (staged.state.plan.manifest.published_at.slice(0, 10) !== day(at))
    throw Error("UTC changed before activation");
  if (digest(catalog) !== staged.state.plan.source_catalog_hash)
    throw Error("Source catalog changed before activation");
  if (
    (await realpath(resolve(base, "var/current"))) !==
    staged.state.expected_previous
  )
    throw Error("Production head changed before activation");
  const info = JSON.parse(
    await regular(staged.dir, "state.PRIVATE.json", 10000000),
  );
  if (digest(info) !== staged.hash || !same(info, staged.state))
    throw Error("Private production state changed");
  const check = await checkProductionSite(staged.publicRoot);
  if (check.digest !== info.public_digest)
    throw Error("Public candidate changed after browser check");
  checkLedger(info.plan.ledger, at);
  const assetDir = resolve(base, "var/assets");
  await mkdir(assetDir, { recursive: true });
  if ((await realpath(assetDir)) !== assetDir)
    throw Error("Symlinked asset parent");
  for (const name of await readdir(resolve(staged.publicRoot, "assets"))) {
    const bytes = await regular(staged.publicRoot, "assets/" + name),
      file = resolve(assetDir, name);
    try {
      await writeFile(file, bytes, { flag: "wx" });
    } catch (e) {
      if (
        e.code !== "EEXIST" ||
        !(await lstat(file)).isFile() ||
        !bytes.equals(await readFile(file))
      )
        throw e;
    }
  }
  // Keep both the original fixed release and all prior daily snapshots/assets.
  if (
    day(now()) !== day(at) ||
    (await realpath(resolve(base, "var/current"))) !== info.expected_previous
  )
    throw Error("UTC or production head changed during activation");
  for (const [name, target] of [
    ["previous", info.expected_previous],
    ["current", staged.publicRoot],
  ]) {
    const dest = resolve(base, "var", name);
    try {
      if (!(await lstat(dest)).isSymbolicLink())
        throw Error("Expected release pointer");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const next = resolve(base, "var", name + "-" + randomUUID());
    await symlink(target, next);
    await rename(next, dest);
  }
  return {
    status: "published",
    edition: info.plan.manifest.active.edition_utc,
    hash: staged.hash,
    digest: check.digest,
    remaining: info.plan.remaining,
    stock_level:
      info.plan.remaining < 7
        ? "action_required"
        : info.plan.remaining < 14
          ? "warning"
          : "ok",
    policy,
    human_trials_verified: false,
  };
}
export async function withProductionLock(base, operation) {
  const dir = resolve(base, "var/production");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if ((await realpath(dir)) !== dir) throw Error("Symlinked production state");
  const lock = resolve(dir, "write.lock");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (e) {
    if (e.code === "EEXIST")
      throw Error("Production writer locked; inspect owner before recovery");
    throw e;
  }
  try {
    await writeFile(
      resolve(lock, "owner.json"),
      JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
      { flag: "wx", mode: 0o600 },
    );
    return await operation();
  } finally {
    await rm(lock, { recursive: true });
  }
}
