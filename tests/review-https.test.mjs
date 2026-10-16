import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { request } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createReviewHttps } from "../packages/puzzle-tools/review-https.ts";

test("private HTTPS requires authentication, verified TLS/host/origin, bounded access and readonly proxy", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "onebox-review-tls-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-keyout",
      join(temp, "key"),
      "-out",
      join(temp, "cert"),
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  const cert = await readFile(join(temp, "cert")),
    key = await readFile(join(temp, "key"));
  let calls = 0,
    clock = Date.now();
  const upstream = createServer((req, res) => {
    calls++;
    assert.equal(req.method, "GET");
    assert.equal(req.headers.cookie, undefined);
    res.setHeader("Content-Type", "application/json");
    res.end('{"private":"synthetic-only"}');
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const hosts = ["placeholder:1"],
    code = "a".repeat(48);
  const gateway = createReviewHttps({
    cert,
    key,
    hosts,
    code,
    upstreamPort: upstream.address().port,
    now: () => clock,
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  const port = gateway.address().port;
  hosts.push(`127.0.0.1:${port}`);
  t.after(async () => {
    gateway.closeAllConnections();
    await new Promise((r) => gateway.close(r));
    await new Promise((r) => upstream.close(r));
    await rm(temp, { recursive: true, force: true });
  });
  function call(path, options = {}) {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          servername: "localhost",
          port,
          path,
          ca: cert,
          method: options.method ?? "GET",
          headers: options.headers,
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () =>
            resolve({ status: res.statusCode, headers: res.headers, body }),
          );
        },
      );
      req.on("error", reject);
      req.end(options.body);
    });
  }
  const login = (body) =>
    call("/access", {
      method: "POST",
      body,
      headers: {
        Origin: `https://127.0.0.1:${port}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
  const entry = await call("/");
  assert.equal(entry.status, 200);
  assert.equal(entry.headers["referrer-policy"], "same-origin");
  for (const path of [
    "/api/candidates",
    "/api/inventory",
    "/assets/private.js",
  ]) {
    const r = await call(path);
    assert.equal(r.status, 403);
    assert.ok(!r.body.includes("synthetic-only"));
  }
  assert.equal(calls, 0);
  assert.equal((await login("code=" + "あ".repeat(48))).status, 413);
  assert.equal((await login("code=" + "é".repeat(48))).status, 403);
  assert.equal((await call("/")).status, 200);
  const logged = await login("code=" + code);
  assert.equal(logged.status, 303);
  const cookie = logged.headers["set-cookie"][0];
  assert.match(cookie, /Secure; HttpOnly; SameSite=Strict/);
  const headers = { Cookie: cookie.split(";")[0] };
  assert.equal((await call("/api/candidates", { headers })).status, 200);
  assert.equal(calls, 1);
  assert.equal(
    (
      await call("/api/candidates", {
        headers: { ...headers, Origin: "https://evil.test" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/candidates", {
        headers: { ...headers, Host: "evil.test" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/candidates", {
        headers: { ...headers, "Sec-Fetch-Site": "cross-site" },
      })
    ).status,
    403,
  );
  assert.equal((await call("/api/candidates?x=1", { headers })).status, 404);
  assert.equal((await call("/anything", { headers })).status, 404);
  assert.equal(
    (await call("/api/candidates", { method: "POST", headers })).status,
    405,
  );
  assert.equal(
    (await call("/logout", { method: "POST", headers })).status,
    403,
  );
  const logout = await call("/logout", {
    method: "POST",
    headers: { ...headers, Origin: `https://127.0.0.1:${port}` },
  });
  assert.equal(logout.status, 303);
  assert.match(logout.headers["set-cookie"][0], /Max-Age=0/);
  clock += 12 * 3600000 + 1;
  assert.equal((await call("/api/candidates", { headers })).status, 403);
  for (let i = 0; i < 5; i++)
    assert.equal((await login("code=wrong")).status, 403);
  assert.equal((await login("code=" + code)).status, 429);
  clock += 60001;
  assert.equal((await login("code=" + code)).status, 303);
  assert.equal(calls, 1);
});
