import { readdir, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { validateManifest } from "../packages/game-core/release.ts";
import { validatePuzzle, canonical } from "../packages/game-core/index.ts";
async function files(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((e) =>
        e.isDirectory() ? files(`${dir}/${e.name}`) : `${dir}/${e.name}`,
      ),
    )
  ).flat();
}
const root = process.argv[2] ?? "dist";
let release = null;
try {
  release = validateManifest(
    JSON.parse(await readFile(`${root}/release.json`, "utf8")),
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (release && release.stage !== "playtest")
  throw Error("This build only allows accepted fixed practice");
let bytes = 0;
let checkedPayload = false;
for (const file of await files(root)) {
  const relative = file.slice(root.length + 1);
  const publicData =
    release &&
    (relative === "release.json" ||
      relative === release.active.payload_url.slice(1));
  if (
    !publicData &&
    !/^(index\.html|(?:ja|en)\/(?:p\/playtest-fixed-v1\/)?index\.html|assets\/[\w.-]+\.(js|css)|assets\/onebox-cover-[a-f0-9]{12}\.png)$/.test(
      file.slice(root.length + 1),
    )
  )
    throw Error(`Unexpected output ${file}`);
  const data = await readFile(file);
  if (release && relative === release.active.payload_url.slice(1)) {
    checkedPayload = true;
    const p = validatePuzzle(JSON.parse(data.toString()));
    if (
      data.length > 10000 ||
      p.purpose !== "practice" ||
      p.puzzle_id !== release.active.puzzle_id ||
      createHash("sha256").update(canonical(p)).digest("hex") !==
        release.active.sha256 ||
      data.toString() !== canonical(p)
    )
      throw Error("Invalid public payload");
  }
  if (file.endsWith(".png")) {
    const hash = createHash("sha256").update(data).digest("hex").slice(0, 12);
    if (
      !file.endsWith(`onebox-cover-${hash}.png`) ||
      data.length > 100000 ||
      data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      data.readUInt32BE(16) !== 1200 ||
      data.readUInt32BE(20) !== 630
    )
      throw Error("Invalid generic cover image");
    continue;
  }
  if (
    /PRIVATE|sample_solution|verified_fixture_batch|negative_test_do_not_publish|production_daily.{0,20}seed|BEGIN PRIVATE KEY/.test(
      data.toString(),
    )
  )
    throw Error(`Private content in ${file}`);
  if (/\.(js|css)$/.test(file)) bytes += gzipSync(data).length;
}
if (release && !checkedPayload)
  throw Error("Manifest references a missing payload");
if (bytes > 250 * 1024)
  throw Error(`Compressed assets exceed budget: ${bytes}`);
console.log(
  `dist allowlist OK; compressed JS+CSS ${bytes} bytes. Fixed development fixtures only, not a production release.`,
);
