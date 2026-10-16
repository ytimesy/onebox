import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { get } from "node:http";
import { createReviewerServer } from "../packages/puzzle-tools/reviewer-server.ts";
import { PrivateStore } from "../packages/puzzle-tools/private-store.ts";
import { generate } from "../packages/puzzle-tools/generator.ts";
import { importBatch } from "../packages/puzzle-tools/curation.ts";

test("loopback reviewer denies rebinding/cross-site/private files and serves puzzle-only without writes", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "onebox-reviewer-"));
  const root = join(temp, "assets-root");
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "index.html"), "<h1>reviewer</h1>");
  await writeFile(join(root, "assets", "main-hash.js"), "export{}");
  await writeFile(join(temp, "answer.js"), "private");
  await symlink(join(temp, "answer.js"), join(root, "assets", "escape.js"));
  const store = new PrivateStore("test-reviewer-" + randomUUID().slice(0, 20));
  const batch = generate({ seed: 12345, count: 2 });
  assert.equal(batch.complete, true);
  await store.mutate((c) =>
    importBatch(c, batch, "test-generated", "test", "2026-10-12T01:00:00.000Z"),
  );
  const before = await store.read();
  const server = createReviewerServer(store, root);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await rm(temp, { recursive: true, force: true });
    await rm(store.dir, { recursive: true, force: true });
  });
  const stockResponse = await fetch(origin + "/api/inventory");
  assert.equal(stockResponse.status, 200);
  assert.equal(stockResponse.headers.get("cache-control"), "no-store");
  assert.equal(stockResponse.headers.get("access-control-allow-origin"), null);
  const stock = await stockResponse.json();
  assert.equal(stock.ready, 0);
  assert.equal(stock.counts.candidate, 2);
  assert.equal(stock.stock.level, "action_required");
  assert.equal(stock.trials.first.completion_rate, null);
  assert.doesNotMatch(
    JSON.stringify(stock),
    /seed|solution|construction|puzzle_id|trial_id|reviewer|notes/,
  );
  assert.equal(
    (
      await fetch(origin + "/api/inventory", {
        headers: { Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(origin + "/api/inventory", { method: "POST" })).status,
    405,
  );
  const stockHead = await fetch(origin + "/api/inventory", { method: "HEAD" });
  assert.equal(stockHead.status, 200);
  assert.equal(await stockHead.text(), "");
  const list = await fetch(origin + "/api/candidates");
  assert.equal(list.status, 200);
  assert.equal(list.headers.get("cache-control"), "no-store");
  assert.equal(list.headers.get("access-control-allow-origin"), null);
  const body = await list.json();
  assert.equal(body.entries.length, 2);
  const id = body.entries[0].id;
  const selected = await (await fetch(`${origin}/api/candidate/${id}`)).json();
  assert.deepEqual(Object.keys(selected).sort(), ["hash", "puzzle"]);
  assert.deepEqual(selected.puzzle, before.entries[0].puzzle);
  assert.doesNotMatch(
    JSON.stringify(body) + JSON.stringify(selected),
    /seed|construction|solution|source|PRIVATE/,
  );
  for (const path of ["/", "/assets/main-hash.js", "/robots.txt"])
    assert.equal((await fetch(origin + path)).status, 200);
  for (const path of [
    "/content/private/curation/main/state.PRIVATE.json",
    "/SPEC.md",
    "/api/candidate/missing",
    "/api/candidates?all=1",
    "/assets/escape.js",
    "/assets/%2e%2e%2fanswer.js",
  ])
    assert.equal((await fetch(origin + path)).status, 404);
  const rebound = await new Promise((resolve, reject) => {
    get(
      origin + "/api/candidates",
      { headers: { Host: "evil.example" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    ).on("error", reject);
  });
  assert.equal(rebound, 403);
  assert.equal(
    (
      await fetch(origin + "/api/candidates", {
        headers: { Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(origin + "/api/candidates", {
        headers: { "Sec-Fetch-Site": "cross-site" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(origin + "/api/candidates", { method: "POST" })).status,
    405,
  );
  const head = await fetch(`${origin}/api/candidate/${id}`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.deepEqual(await store.read(), before);
  // Integrity failure fails closed; it never sends parser details or private data.
  await writeFile(
    join(store.dir, "state.PRIVATE.json"),
    '{"secret":"test-marker"}',
  );
  const invalid = await fetch(origin + "/api/candidates");
  assert.equal(invalid.status, 503);
  assert.equal(await invalid.text(), "");
  const invalidStock = await fetch(origin + "/api/inventory");
  assert.equal(invalidStock.status, 503);
  assert.equal(await invalidStock.text(), "");
});
