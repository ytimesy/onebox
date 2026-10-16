import assert from "node:assert/strict";
import { readFile, readlink, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import {
  PrivateStore,
  privateRoot,
} from "../packages/puzzle-tools/private-store.ts";
import { inventory } from "../packages/puzzle-tools/inventory.ts";
import { digest } from "../packages/puzzle-tools/generator.ts";

// Read-only checks of the installed loopback reviewer, never select a candidate.
const origin = "http://localhost:4324",
  publicOrigin = "https://onebox.formflow-ops.com";
const store = new PrivateStore(),
  before = await store.read();
const response = await fetch(origin + "/api/inventory");
assert.equal(response.status, 200);
assert.equal(response.headers.get("cache-control"), "no-store");
assert.equal(response.headers.get("access-control-allow-origin"), null);
const actual = await response.json();
assert.deepEqual(actual, inventory(before, actual.checked_at));
const browser = await chromium.launch();
const widths = [320, 390, 768, 1440],
  privateAssets: string[] = [];
try {
  const page = await browser.newPage(),
    errors: string[] = [],
    requests: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(origin);
  const panel = page.getByRole("region", {
    name: "在庫と試遊集計",
    exact: true,
  });
  await panel.getByTestId("ready-stock").waitFor();
  assert.match(
    (await panel.getByTestId("ready-stock").textContent()) ?? "",
    new RegExp(`公開待ち：${actual.ready}問`),
  );
  if (!actual.trials.first.starts)
    assert.match(
      (await panel
        .getByRole("region", { name: "初回集計", exact: true })
        .textContent()) ?? "",
      /完了率未計測/,
    );
  await panel.getByRole("button", { name: "在庫を再確認" }).click();
  await panel.getByTestId("ready-stock").waitFor();
  const screenshots = `${privateRoot}/reviewer-evidence`;
  await mkdir(screenshots, { recursive: true, mode: 0o700 });
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `${screenshots}/stock-live-${width}.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  assert.ok(requests.every((url) => url.startsWith(origin + "/")));
  const files = await page
    .locator('script[src], link[rel="stylesheet"]')
    .evaluateAll((elements) =>
      elements
        .map((e) => e.getAttribute("src") ?? e.getAttribute("href")!)
        .filter((path) => path.startsWith("/assets/")),
    );
  privateAssets.push(...files);
} finally {
  await browser.close();
}
const paths = [
  "/health",
  "/ja/",
  "/en/",
  "/api/inventory",
  "/api/candidates",
  "/reviewer/",
  ...privateAssets,
];
const publicChecks: Record<string, number> = {};
for (const path of paths) {
  const r = await fetch(publicOrigin + path, {
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(
    r.status,
    ["/health", "/ja/", "/en/"].includes(path) ? 200 : 404,
  );
  publicChecks[path] = r.status;
  await r.arrayBuffer();
}
assert.equal(digest(await store.read()), digest(before));
const report = {
  checked_at: new Date().toISOString(),
  inventory: actual,
  installed_browser: {
    engine: "chromium",
    widths,
    overflow: false,
    page_errors: 0,
    local_only_requests: true,
    candidate_selected: false,
  },
  real_catalog_unchanged: true,
  public_checks: publicChecks,
  public_release: await readlink("var/current"),
};
await writeFile(
  "evidence/t22-stock-live.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  "Installed reviewer: inventory matches read-only catalog; 4 layouts PASS; public health/JA/EN 200, private endpoints/assets 404; catalog unchanged.",
);
