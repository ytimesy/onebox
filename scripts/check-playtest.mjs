import { chromium, firefox, webkit } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = process.argv[2] ?? "http://127.0.0.1:4323";
const publicCheck = origin.startsWith("https:");
const solution = JSON.parse(
  await readFile("examples/sample_solution.PRIVATE.json", "utf8"),
).placements;
const actualChrome = process.env.ONEBOX_CHROME === "1";
const engines = actualChrome
  ? { chrome: { launch: () => chromium.launch({ channel: "chrome" }) } }
  : publicCheck
    ? { chromium }
    : { chromium, firefox, webkit };
const rows = [];
let expectedPuzzleHash;
for (const [name, engine] of Object.entries(engines)) {
  const browser = await engine.launch();
  rows.push(`${name} browser ${browser.version()}`);
  try {
    for (const locale of ["ja", "en"]) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      });
      const page = await context.newPage();
      const errors = [],
        violations = [],
        responses = [];
      page.on("response", (response) => responses.push(response.url()));
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        window.cspViolations = [];
        document.addEventListener("securitypolicyviolation", (e) =>
          window.cspViolations.push(`${e.violatedDirective}: ${e.blockedURI}`),
        );
      });
      const response = await page.goto(`${origin}/${locale}/`);
      assert.equal(response.status(), 200);
      assert.match(
        response.headers()["content-security-policy"],
        /worker-src 'self'/,
      );
      await page
        .getByText(
          locale === "ja" ? "固定問題 · 試遊版" : "Fixed puzzle · Playtest",
          { exact: true },
        )
        .waitFor();
      await page
        .getByRole("button", {
          name: locale === "ja" ? "箱を開く" : "Open the box",
        })
        .tap();
      await page.locator(".board").waitFor();
      assert.match(
        await page.locator(".puzzle-id").textContent(),
        /playtest-fixed-v1/,
      );
      assert.match(
        await page.locator(".puzzle-id").textContent(),
        locale === "ja" ? /練習/ : /Practice/,
      );
      await page
        .getByRole("button", {
          name: locale === "ja" ? "ヒント" : "Hint",
          exact: false,
        })
        .tap();
      await page
        .getByRole("status")
        .first()
        .filter({ hasText: locale === "ja" ? "置き場所" : "place" })
        .waitFor();
      for (const q of solution) {
        await page.locator(`[data-piece="${q.piece_id}"]`).tap();
        for (let i = 0; i < q.rotation; i++)
          await page
            .getByRole("button", {
              name: locale === "ja" ? "回転" : "Rotate",
              exact: false,
            })
            .tap();
        await page.locator(`[data-cell="${q.x},${q.y}"]`).tap();
        await page
          .locator(".controls")
          .getByRole("button", {
            name: locale === "ja" ? "置く" : "Place",
            exact: false,
          })
          .tap();
      }
      await page
        .getByRole("heading", {
          name: locale === "ja" ? "ぴったり！" : "A perfect fit!",
        })
        .waitFor();
      assert.equal(await page.locator(".badge").count(), 0);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
      }
      const records = await page.evaluate(() =>
        Object.keys(localStorage)
          .filter((k) => k.startsWith("onebox:v1:run:"))
          .map((k) => JSON.parse(localStorage[k])),
      );
      assert.equal(records.length, 1);
      assert.equal(records[0].state, "completed");
      assert.equal(records[0].mode, "practice");
      assert.equal(records[0].hint_count, 1);
      expectedPuzzleHash ??= records[0].puzzle_hash;
      assert.equal(records[0].puzzle_hash, expectedPuzzleHash);
      rows.push(`${name} ${locale}: puzzle_hash=${records[0].puzzle_hash}`);
      violations.push(...(await page.evaluate(() => window.cspViolations)));
      if (publicCheck) {
        // The shared zone inserts Google gateway tags. They must remain blocked,
        // including its same-origin loader, without changing neighboring services.
        const allowedBlocks = [
          "script-src-elem: inline",
          "script-src-elem: https://www.googletagmanager.com/gtag/js?id=G-BKP7HZERRL&gtg_health=1",
          `${"script-src-elem: "}${origin}/vuam/`,
        ];
        assert.deepEqual(
          violations.filter((v) => !allowedBlocks.includes(v)),
          [],
        );
        assert.deepEqual(
          await page.evaluate(() => ({
            gtag: typeof window.gtag,
            dataLayer: typeof window.dataLayer,
            firstParty: typeof window.google_tags_first_party,
          })),
          {
            gtag: "undefined",
            dataLayer: "undefined",
            firstParty: "undefined",
          },
        );
        assert.deepEqual(await context.cookies(), []);
        assert.deepEqual(
          responses.filter((url) => {
            const parsed = new URL(url);
            return (
              parsed.origin !== origin ||
              !(
                parsed.pathname === `/${locale}/` ||
                parsed.pathname === "/release.json" ||
                parsed.pathname === `/puzzles/${expectedPuzzleHash}.json` ||
                parsed.pathname.startsWith("/assets/")
              )
            );
          }),
          [],
        );
        rows.push(
          `${name} ${locale}: known edge tag CSP blocks=${violations.length}; no tag execution/cookies/analytics responses`,
        );
      } else assert.deepEqual(violations, []);
      assert.deepEqual(errors, []);
      if (publicCheck)
        await page.screenshot({
          path: `evidence/public-${locale}.png`,
          fullPage: true,
        });
      rows.push(
        `${name} ${locale}: HTTPS=${publicCheck}, start/hint/touch completion/practice/save/4 widths/CSP enforcement passed`,
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
// Few read-only route checks; no load test.
for (const path of [
  "/health",
  "/robots.txt",
  "/SPEC.md",
  "/examples/sample_solution.PRIVATE.json",
  "/manifest.json",
  "/ja/p/not-published/",
]) {
  const response = await fetch(origin + path);
  assert.equal(
    response.status,
    ["/health", "/robots.txt"].includes(path) ? 200 : 404,
  );
  rows.push(`${path}: ${response.status}`);
}
const report = rows.join("\n") + "\n";
await writeFile(
  `evidence/${publicCheck ? "public" : "playtest-local"}${actualChrome ? "-chrome" : ""}-smoke.txt`,
  report,
);
console.log(report);
