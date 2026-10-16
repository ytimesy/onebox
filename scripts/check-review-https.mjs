import { readFile, writeFile, mkdir } from "node:fs/promises";
import { request } from "node:https";
import { createServer } from "node:http";
import { connect } from "node:net";
import { once } from "node:events";
import { createHash, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const dir = "var/review-https",
  config = JSON.parse(await readFile(dir + "/config.json", "utf8")),
  ca = await readFile(dir + "/ca.crt"),
  code = (await readFile(dir + "/access-code.txt", "utf8")).trim(),
  cert = new X509Certificate(await readFile(dir + "/server.crt"));
const catalog = "content/private/curation/main/state.PRIVATE.json",
  hash = (b) => createHash("sha256").update(b).digest("hex"),
  before = hash(await readFile(catalog));
execFileSync(
  "openssl",
  ["verify", "-CAfile", dir + "/ca.crt", dir + "/server.crt"],
  { stdio: "ignore" },
);
const origin = `https://${config.bind}:4325`;
const call = (path) =>
  new Promise((resolve, reject) => {
    const req = request(
      origin + path,
      { ca, localAddress: "127.0.0.1", timeout: 5000 },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.on("timeout", () =>
      req.destroy(new Error("LAN HTTPS connection timed out")),
    );
    req.end();
  });
assert.equal(await call("/"), 200);
assert.equal(await call("/api/candidates"), 403);
// Pin only this generated leaf for browser automation. This is not evidence that
// an actual phone has installed/trusted the private CA.
const pin = createHash("sha256")
  .update(cert.publicKey.export({ type: "spki", format: "der" }))
  .digest("base64");
// This Mac's LAN-to-self route stalls TLS; verify the actual installed listener
// from loopback without changing shared networking or pretending to test a phone.
const sockets = new Set(),
  proxy = createServer((_req, res) => {
    res.writeHead(403);
    res.end();
  });
proxy.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});
proxy.on("connect", (req, client, head) => {
  if (req.url !== `${config.bind}:4325`) {
    client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  const target = connect(
    { host: config.bind, port: 4325, localAddress: "127.0.0.1" },
    () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) target.write(head);
      client.pipe(target);
      target.pipe(client);
    },
  );
  target.on("error", () => client.destroy());
  client.on("error", () => target.destroy());
  client.on("close", () => target.destroy());
});
proxy.listen(0, "127.0.0.1");
await once(proxy, "listening");
const browser = await chromium.launch({
  args: [
    `--ignore-certificate-errors-spki-list=${pin}`,
    `--proxy-server=http://127.0.0.1:${proxy.address().port}`,
  ],
});
try {
  const context = await browser.newContext({
      acceptDownloads: true,
      hasTouch: true,
      viewport: { width: 390, height: 844 },
    }),
    page = await context.newPage(),
    errors = [],
    statuses = [];
  let loginHeaders;
  page.on("request", async (req) => {
    if (new URL(req.url()).pathname === "/access") {
      const h = await req.allHeaders();
      loginHeaders = {
        origin: h.origin,
        site: h["sec-fetch-site"],
        contentType: h["content-type"],
      };
    }
  });
  page.on("response", (response) =>
    statuses.push({
      path: new URL(response.url()).pathname,
      status: response.status(),
    }),
  );
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await expect(
    page.getByRole("heading", { name: "ONEBOX 非公開試遊" }),
  ).toBeVisible();
  await page.getByLabel("アクセスコード").fill(code);
  await page.getByRole("button", { name: "試遊画面を開く" }).click();
  try {
    await expect(
      page.getByRole("heading", { name: "候補を試す" }),
    ).toBeVisible();
  } catch (error) {
    console.log(
      "Gateway login diagnostics:",
      JSON.stringify({
        statuses,
        loginHeaders,
        denial: (await page.locator("body").innerText()).slice(0, 64),
        cookieMetadata: (await context.cookies()).map(
          ({ name, secure, httpOnly, sameSite }) => ({
            name,
            secure,
            httpOnly,
            sameSite,
          }),
        ),
        secureContext: await page.evaluate(() => window.isSecureContext),
        errors,
      }),
    );
    throw error;
  }
  const cookie = (await context.cookies()).find(
    (c) => c.name === "__Host-onebox-review",
  );
  assert.equal(cookie.secure, true);
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "Strict");
  assert.equal(
    await page.evaluate(() => document.cookie.includes("onebox-review")),
    false,
  );
  assert.equal(await page.evaluate(() => window.isSecureContext), true);
  const candidateSelect = page
    .getByRole("region", { name: "候補試遊", exact: true })
    .locator("select")
    .first();
  await expect(candidateSelect.locator("option")).toHaveCount(6);
  const options = await candidateSelect
    .locator("option")
    .evaluateAll((values) => values.map((v) => v.value).filter(Boolean));
  assert.equal(options.length, 5);
  await candidateSelect.selectOption(options[0]);
  await page.getByRole("button", { name: "箱を開く", exact: false }).click();
  await page
    .getByRole("button", { name: "終了して試遊を記録", exact: true })
    .click();
  await page.getByLabel("実際に操作した端末").selectOption("phone");
  await page
    .getByRole("checkbox", { name: "実際に自分が操作した結果", exact: false })
    .check();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSONを書き出す", exact: true })
    .click();
  const downloaded = await downloadEvent,
    report = JSON.parse(await readFile(await downloaded.path(), "utf8"));
  assert.equal(report.device, "phone");
  assert.equal(report.outcome, "unfinished");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  }
  assert.deepEqual(errors, []);
  await context.close();
} finally {
  await browser.close();
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => proxy.close(resolve));
}
assert.equal(hash(await readFile(catalog)), before);
await mkdir("evidence", { recursive: true });
await writeFile(
  "evidence/review-https-live.txt",
  "Installed HTTPS listener, from loopback source: trusted-CA native TLS/hostname verification PASS; unauthorized API403; pinned-leaf Chromium via temporary loopback CONNECT secure context/auth/cookie protections/4 widths/synthetic phone unfinished JSON download PASS. LAN-to-self source times out; external phone LAN transport and CA installation NOT VERIFIED. Network/firewall settings unchanged. Real catalog unchanged; no report imported.\n",
);
console.log(
  "Installed HTTPS listener auth/browser/export PASS from loopback; external LAN not verified; catalog unchanged. Phone export is an automated synthetic test.",
);
