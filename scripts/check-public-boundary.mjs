import assert from "node:assert/strict";
import { readFile, readdir, readlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { artifactDigest } from "./artifact.mjs";
import {
  validateManifest,
  validatePublishedPuzzle,
} from "../packages/game-core/release.ts";

const origin = "https://onebox.formflow-ops.com";
const snapshot = JSON.parse(
  await readFile("var/history-boundary-before.json", "utf8"),
);
const sha = (data) => createHash("sha256").update(data).digest("hex");
assert.equal(
  sha(await readFile("content/private/curation/main/state.PRIVATE.json")),
  snapshot.curation,
);
assert.equal(
  sha(await readFile(`${homedir()}/.cloudflared/config.yml`)),
  snapshot.shared_config,
);
const current = await readlink("var/current"),
  previous = await readlink("var/previous");
assert.equal(
  await artifactDigest(current),
  await artifactDigest("dist-playtest"),
);
const assets = [];
for (const root of [current, previous]) {
  for (const name of await readdir(root + "/assets")) {
    const response = await fetch(`${origin}/assets/${name}`, {
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200);
    assert.equal(
      sha(Buffer.from(await response.arrayBuffer())),
      sha(await readFile(`${root}/assets/${name}`)),
    );
    assets.push({
      release: root.split("/").at(-1),
      asset: name,
      status: 200,
      hash_match: true,
    });
  }
}
const privateFiles = (await readdir("var/reviewer/assets")).filter(
  (name) => !name.startsWith("hint.worker-"),
);
const checks = {};
const manifestResponse = await fetch(origin + "/release.json"),
  manifest = validateManifest(await manifestResponse.json());
assert.equal(manifestResponse.status, 200);
assert.equal(manifest.stage, "playtest");
assert.equal(manifest.next_update_at, null);
const payloadResponse = await fetch(origin + manifest.active.payload_url);
assert.equal(payloadResponse.status, 200);
await validatePublishedPuzzle(await payloadResponse.json(), manifest.active);
checks["/release.json"] = 200;
checks[manifest.active.payload_url] = 200;
for (const path of [
  "/health",
  "/ja/",
  "/en/",
  "/api/inventory",
  "/api/candidates",
  "/reviewer/",
  "/SPEC.md",
  "/manifest.json",
  ...privateFiles.map((name) => `/assets/${name}`),
]) {
  const response = await fetch(origin + path, {
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(
    response.status,
    ["/health", "/ja/", "/en/"].includes(path) ? 200 : 404,
  );
  await response.arrayBuffer();
  checks[path] = response.status;
}
const report = {
  checked_at: new Date().toISOString(),
  public_release: current,
  previous_release: previous,
  digest: await artifactDigest(current),
  assets,
  public_checks: checks,
  real_catalog_unchanged: true,
  shared_tunnel_config_unchanged: true,
};
await writeFile(
  "evidence/history-public-boundary.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  "Current/previous HTTPS assets match; private assets/API/docs/manifest remain 404; catalog and shared tunnel config unchanged.",
);
