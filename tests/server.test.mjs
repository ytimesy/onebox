import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { get } from "node:http";
test("public server exposes released HTML, JS/CSS and generic cover only, with CSP and cache policy", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "onebox-server-")),
    root = join(temp, "site");
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "index.html"), "<h1>trial</h1>");
  await mkdir(join(root, "puzzles"));
  await writeFile(join(root, "release.json"), '{"stage":"playtest"}');
  await writeFile(join(root, "puzzles", "a".repeat(64) + ".json"), "{}");
  for (const locale of ["ja", "en"]) {
    for (const suffix of ["", "/p/playtest-fixed-v1"]) {
      const dir = join(root, locale + suffix);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "index.html"), `<h1>${locale}${suffix}</h1>`);
    }
  }
  await writeFile(
    join(root, "assets", "onebox-cover-aaaaaaaaaaaa.png"),
    "generic cover",
  );
  await writeFile(
    join(root, "assets", "hint.worker-hash.js"),
    "self.onmessage=()=>{}",
  );
  await writeFile(join(root, "assets", "main-hash.css"), "body{color:green}");
  await writeFile(join(temp, "secret.js"), "private");
  await symlink(join(temp, "secret.js"), join(root, "assets", "escape.js"));
  const child = spawn(
    process.execPath,
    [resolve("scripts/static-server.mjs")],
    {
      env: {
        ...process.env,
        ONEBOX_SERVE_ROOT: root,
        ONEBOX_PORT: "0",
        PUBLIC_ORIGIN: "https://onebox.test",
      },
    },
  );
  t.after(async () => {
    const stopped = once(child, "exit");
    child.kill("SIGTERM");
    await stopped;
    await rm(temp, { recursive: true, force: true });
  });
  const [chunk] = await once(child.stdout, "data");
  const origin = `http://127.0.0.1:${String(chunk).match(/:(\d+)/)[1]}`;
  for (const path of ["/", "/ja/", "/en/"]) {
    const r = await fetch(origin + path);
    assert.equal(r.status, 200);
    assert.equal(
      await r.text(),
      path === "/" ? "<h1>trial</h1>" : `<h1>${path.slice(1, -1)}</h1>`,
    );
    assert.match(r.headers.get("content-security-policy"), /worker-src 'self'/);
    assert.match(
      r.headers.get("content-security-policy"),
      /script-src http:\/\/127\.0\.0\.1:[0-9]+\/assets\//,
    );
    assert.doesNotMatch(
      r.headers.get("content-security-policy"),
      /script-src 'self'/,
    );
    assert.equal(
      r.headers.get("cache-control"),
      "public, no-cache, no-transform",
    );
    assert.match(r.headers.get("x-robots-tag"), /noindex/);
  }
  const publicCSP = await new Promise((resolve, reject) => {
    get(origin, { headers: { Host: "onebox.test" } }, (res) => {
      res.resume();
      resolve(res.headers["content-security-policy"]);
    }).on("error", reject);
  });
  assert.match(publicCSP, /script-src https:\/\/onebox\.test\/assets\//);
  assert.doesNotMatch(publicCSP, /http:\/\/(127\.0\.0\.1|localhost)/);
  const worker = await fetch(origin + "/assets/hint.worker-hash.js");
  const release = await fetch(origin + "/release.json");
  assert.equal(release.status, 200);
  assert.match(release.headers.get("content-type"), /application\/json/);
  assert.match(release.headers.get("cache-control"), /no-cache/);
  const payload = await fetch(origin + "/puzzles/" + "a".repeat(64) + ".json");
  assert.equal(payload.status, 200);
  assert.match(payload.headers.get("cache-control"), /immutable/);
  assert.equal(
    (await fetch(origin + "/puzzles/" + "b".repeat(64) + ".json")).status,
    404,
  );
  assert.equal(worker.status, 200);
  assert.match(worker.headers.get("cache-control"), /immutable/);
  assert.equal(
    (await fetch(origin + "/assets/main-hash.css")).headers.get("content-type"),
    "text/css; charset=utf-8",
  );
  for (const locale of ["ja", "en"]) {
    const path = `/${locale}/p/playtest-fixed-v1/`;
    for (const query of ["", "?src=share"]) {
      const r = await fetch(origin + path + query);
      assert.equal(r.status, 200);
      assert.equal(await r.text(), `<h1>${locale}/p/playtest-fixed-v1</h1>`);
    }
  }
  const cover = await fetch(origin + "/assets/onebox-cover-aaaaaaaaaaaa.png");
  assert.equal(cover.status, 200);
  assert.equal(cover.headers.get("content-type"), "image/png");
  assert.match(cover.headers.get("cache-control"), /immutable/);
  for (const path of [
    "/SPEC.md",
    "/examples/sample_solution.PRIVATE.json",
    "/manifest.json",
    "/missing",
    "/assets/escape.js",
    "/assets/%2e%2e%2fsecret.js",
    "/ja/p/playtest-fixed-v1/?src=share&run_id=secret",
    "/ja/p/playtest-fixed-v1/?src=evil",
    "/ja/p/playtest-fixed-v1/?src=share&src=share",
    "/ja/p/playtest-fixed-v1",
    "/en/p/future/",
    "/ja/p/candidate-35bad118a3d8/",
    "/fr/",
    "/assets/private.png",
  ])
    assert.equal((await fetch(origin + path)).status, 404, path);
  assert.equal((await fetch(origin + "/%zz")).status, 400);
  const head = await fetch(origin + "/", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await fetch(origin + "/", { method: "POST" })).status, 405);
  assert.deepEqual(await (await fetch(origin + "/health")).json(), {
    status: "ok",
    stage: "playtest",
  });
  assert.match(
    await (await fetch(origin + "/robots.txt")).text(),
    /Disallow: \//,
  );
  // Rolling back to a checked single-HTML release preserves this known fixed URL.
  const legacyPath = join(root, "en/p/playtest-fixed-v1/index.html");
  await rm(legacyPath);
  const legacy = await fetch(origin + "/en/p/playtest-fixed-v1/?src=share");
  assert.equal(legacy.status, 200);
  assert.equal(legacy.url, origin + "/en/p/playtest-fixed-v1/?src=share");
  assert.equal(await legacy.text(), "<h1>trial</h1>");
  assert.equal((await fetch(origin + "/en/p/not-published/")).status, 404);
  await symlink(join(temp, "secret.js"), legacyPath);
  assert.equal((await fetch(origin + "/en/p/playtest-fixed-v1/")).status, 404);
  await rm(join(root, "index.html"));
  assert.equal((await fetch(origin + "/health")).status, 503);
});
