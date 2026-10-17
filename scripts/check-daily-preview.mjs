import { chromium, firefox, webkit, expect } from "@playwright/test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  cp,
  readFile,
  writeFile,
  mkdir,
  rm,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  validateManifest,
  validatePublishedPuzzle,
} from "../packages/game-core/release.ts";
import {
  canonical,
  hashPuzzle,
  validatePuzzle,
} from "../packages/game-core/index.ts";
import { solve } from "../packages/game-core/solver.ts";
const root = await mkdtemp(join(tmpdir(), "onebox-daily-simulation-"));
const evidenceDir = resolve(
  process.env.ONEBOX_DAILY_EVIDENCE ?? "evidence/daily-check",
);
await mkdir(evidenceDir, { recursive: true });
await cp("evidence/daily-preview", root, { recursive: true });
const original = validateManifest(
  JSON.parse(await readFile(`${root}/release.json`, "utf8")),
);
async function switchManifest(manifest) {
  await writeFile(
    `${root}/release.next`,
    canonical(validateManifest(manifest)),
  );
  await rename(`${root}/release.next`, `${root}/release.json`);
}
const child = spawn(
  process.execPath,
  [resolve("scripts/daily-preview-server.mjs")],
  {
    env: {
      ...process.env,
      ONEBOX_DAILY_PREVIEW_ROOT: root,
      ONEBOX_DAILY_PREVIEW_PORT: "0",
    },
    stdio: ["ignore", "pipe", "inherit"],
  },
);
const [output] = await once(child.stdout, "data");
const origin = String(output).match(/http:\/\/127\.0\.0\.1:\d+/)[0],
  lines = [];
try {
  const engines = { chromium, firefox, webkit };
  const selectedEngine = process.env.ONEBOX_DAILY_ENGINE;
  if (selectedEngine && !Object.hasOwn(engines, selectedEngine))
    throw Error("Unknown daily test engine");
  for (const [name, engine] of Object.entries(engines).filter(
    ([name]) => !selectedEngine || name === selectedEngine,
  )) {
    await switchManifest(original);
    const browser = await engine.launch();
    try {
      for (const locale of ["ja", "en"]) {
        const ja = locale === "ja",
          entry = original.recent[1],
          context = await browser.newContext({
            timezoneId: ja ? "Asia/Tokyo" : "America/Los_Angeles",
            viewport: { width: 390, height: 844 },
          });
        const page = await context.newPage(),
          errors = [];
        let phase = "initial";
        page.on("pageerror", (e) =>
          errors.push({ phase, message: e.message, stack: e.stack }),
        );
        try {
          const path = `/${locale}/p/${entry.slug}/?src=share`;
          assert.equal((await page.goto(origin + path)).status(), 200);
          await page
            .getByRole("button", {
              name: ja ? "箱を開く" : "Open the box",
              exact: false,
            })
            .click();
          await expect(page.locator(".puzzle-id")).toContainText(
            entry.puzzle_id,
          );
          const puzzle = await validatePublishedPuzzle(
              JSON.parse(await readFile(root + entry.payload_url, "utf8")),
              entry,
            ),
            solution = solve(puzzle).solutions[0];
          // Switch only the current manifest; an in-progress past URL keeps its ID/hash.
          const next = {
            ...original,
            published_at: "2026-10-18T00:00:01.000Z",
            release_status: "delayed",
            next_update_at: "2026-10-19T00:00:00.000Z",
          };
          await switchManifest(next);
          await page.clock.setSystemTime(new Date("2026-10-19T09:00:00Z"));
          await context.setOffline(true);
          for (const q of solution) {
            await page.locator(`[data-piece="${q.piece_id}"]`).click();
            const initial = puzzle.pieces.find(
              (p) => p.id === q.piece_id,
            ).initial_rotation;
            for (let i = 0; i < (q.rotation - initial + 4) % 4; i++)
              await page
                .getByRole("button", {
                  name: ja ? "回転" : "Rotate",
                  exact: false,
                })
                .click();
            await page.locator(`[data-cell="${q.x},${q.y}"]`).click();
            await page
              .locator(".controls")
              .getByRole("button", {
                name: ja ? "置く" : "Place",
                exact: false,
              })
              .click();
          }
          await expect(
            page.getByRole("heading", {
              name: ja ? "ぴったり！" : "A perfect fit!",
              exact: true,
            }),
          ).toBeVisible();
          const saved = await page.evaluate(
            (id) => JSON.parse(localStorage.getItem(`onebox:v1:current:${id}`)),
            entry.puzzle_id,
          );
          assert.equal(saved.puzzle_hash, entry.sha256);
          assert.equal(saved.mode, "first");
          await page
            .getByRole("button", {
              name: ja ? "Xに投稿" : "Post to X",
              exact: true,
            })
            .click();
          const text = await page
            .locator(".share-dialog textarea")
            .inputValue();
          assert.ok(text.endsWith(origin + path));
          assert.ok(!text.includes(saved.run_id));
          await page
            .locator(".share-dialog")
            .getByRole("button", { name: ja ? "閉じる" : "Close", exact: true })
            .click();
          await expect(
            page.getByRole("link", {
              name: ja ? "今日の問題へ" : "Go to today's puzzle",
            }),
          ).toBeVisible();
          await context.setOffline(false);
          await page.goto(origin + `/${locale}/`);
          await expect(
            page.getByText(
              ja ? "新しい挑戦は練習" : "New attempts are practice",
              { exact: false },
            ),
          ).toBeVisible();
          await page
            .getByRole("button", {
              name: ja ? "箱を開く" : "Open the box",
              exact: false,
            })
            .click();
          await expect(page.locator(".puzzle-id")).toContainText(
            ja ? "練習" : "Practice",
          );
          await page
            .getByRole("button", { name: ja ? "Language" : "Language" })
            .click();
          await expect(page.locator(".puzzle-id")).toContainText(
            original.active.puzzle_id,
          );
          const switchedLocale = ja ? "en" : "ja";
          phase = "offline-history";
          const history = () =>
            page.getByRole("button", {
              name: ja ? "Last 7 attempts" : "直近7回の記録",
              exact: true,
            });
          const historyDialog = page.locator(".recent-dialog");
          const closeHistory = () =>
            historyDialog
              .getByRole("button", {
                name: ja ? "Back to the puzzle" : "問題に戻る",
                exact: true,
              })
              .click();
          // These two records came from actual UI operations on two editions.
          // Both payloads remain cached after visiting the active edition.
          await context.setOffline(true);
          await history().click();
          await expect(historyDialog.locator("li")).toHaveCount(2);
          await expect(historyDialog.locator("li").first()).toContainText(
            ja ? "Unfinished" : "未完了",
          );
          await expect(historyDialog.locator("li").last()).toContainText(
            ja ? "Completed" : "完成",
          );
          for (const e of original.recent)
            await expect(
              historyDialog.getByRole("link", { name: e.edition_utc }),
            ).toHaveAttribute("href", `/${switchedLocale}/p/${e.slug}/`);
          await expect(page.locator(".board")).toHaveCount(0);
          for (const width of [320, 375, 390, 768, 1280, 1440]) {
            await page.setViewportSize({ width, height: 844 });
            assert.equal(
              await page.evaluate(
                () =>
                  document.documentElement.scrollWidth <= innerWidth &&
                  document.querySelector(".recent-dialog").scrollWidth <=
                    document.querySelector(".recent-dialog").clientWidth,
              ),
              true,
            );
            if (width === 390 && name === "chromium" && ja)
              await page.screenshot({ path: `${evidenceDir}/history-390.png` });
          }
          if (name === "chromium" && ja)
            await page.screenshot({
              path: `${evidenceDir}/history-1440.png`,
              fullPage: true,
            });
          await page.keyboard.press("Escape");
          await expect(history()).toBeFocused();
          const durableBefore = await page.evaluate(() =>
            JSON.stringify(
              Object.fromEntries(
                Object.keys(localStorage)
                  .filter((k) => k.startsWith("onebox:v1:run:"))
                  .sort()
                  .map((k) => [k, localStorage.getItem(k)]),
              ),
            ),
          );
          const completeCache = await page.evaluate(() =>
            sessionStorage.getItem("onebox:v1:public-cache"),
          );
          await page.evaluate((hash) => {
            const v = JSON.parse(
              sessionStorage.getItem("onebox:v1:public-cache"),
            );
            delete v.puzzles[hash];
            sessionStorage.setItem("onebox:v1:public-cache", JSON.stringify(v));
          }, entry.sha256);
          // Explicit failure also disables the HTTP cache: an offline browser can
          // legitimately still serve immutable payloads from its own cache.
          await page.route("**" + entry.payload_url, (route) => route.abort());
          await history().click();
          await expect(historyDialog.locator("li")).toHaveCount(1);
          await expect(historyDialog).toContainText(
            ja ? "Nothing was deleted" : "記録は削除していません",
          );
          await closeHistory();
          assert.equal(
            await page.evaluate(() =>
              JSON.stringify(
                Object.fromEntries(
                  Object.keys(localStorage)
                    .filter((k) => k.startsWith("onebox:v1:run:"))
                    .sort()
                    .map((k) => [k, localStorage.getItem(k)]),
                ),
              ),
            ),
            durableBefore,
          );
          await page.evaluate(
            (value) => sessionStorage.setItem("onebox:v1:public-cache", value),
            completeCache,
          );
          await history().click();
          await expect(historyDialog.locator("li")).toHaveCount(2);
          await closeHistory();
          await page.unrouteAll();
          await context.setOffline(false);
          phase = "manifest-network-fallback";
          await page.route("**/release.json", (route) => route.abort());
          // Navigate to the earlier fixed URL after another payload was cached.
          await page.goto(origin + `/${switchedLocale}/p/${entry.slug}/`);
          await expect(
            page.getByText(
              ja
                ? `Cached edition ${entry.edition_utc}`
                : `${entry.edition_utc}版の取得済み問題`,
              { exact: false },
            ),
          ).toBeVisible();
          const cache = await page.evaluate(() =>
            sessionStorage.getItem("onebox:v1:public-cache"),
          );
          await page.evaluate((hash) => {
            const v = JSON.parse(
              sessionStorage.getItem("onebox:v1:public-cache"),
            );
            delete v.puzzles[hash];
            sessionStorage.setItem("onebox:v1:public-cache", JSON.stringify(v));
          }, entry.sha256);
          await page.reload();
          await expect(
            page.getByRole("button", {
              name: ja ? "Try again" : "もう一度読み込む",
              exact: true,
            }),
          ).toBeVisible();
          await page.evaluate(
            (value) => sessionStorage.setItem("onebox:v1:public-cache", value),
            cache,
          );
          await page.goto(origin + `/${switchedLocale}/`);
          await page.reload();
          await expect(
            page.getByText(
              ja ? "New attempts are practice" : "新しい挑戦は練習",
              { exact: false },
            ),
          ).toBeVisible();
          await page.unrouteAll();
          for (const status of [200, 410]) {
            phase = `manifest-rejection-${status}`;
            await page.route("**/release.json", (route) =>
              route.fulfill({
                status,
                contentType: "application/json",
                body: "{",
              }),
            );
            await page.reload();
            await expect(
              page.getByRole("button", {
                name: ja ? "Try again" : "もう一度読み込む",
                exact: true,
              }),
            ).toBeVisible();
            await page.unrouteAll();
          }
          phase = "payload-network-fallback";
          await page.route("**" + original.active.payload_url, (route) =>
            route.abort(),
          );
          await page.reload();
          await expect(
            page.getByText(
              ja ? "New attempts are practice" : "新しい挑戦は練習",
              { exact: false },
            ),
          ).toBeVisible();
          await page.unrouteAll();
          phase = "corrupt-payload";
          await page.route("**" + original.active.payload_url, (route) =>
            route.fulfill({ contentType: "application/json", body: "{}" }),
          );
          await page.reload();
          await expect(
            page.getByText(
              ja ? "Could not load the puzzle" : "問題を読み込めませんでした",
              { exact: false },
            ),
          ).toBeVisible();
          await page.unrouteAll();
          const withdrawn = { ...next, recalled_ids: [entry.puzzle_id] };
          phase = "recall";
          await switchManifest(withdrawn);
          await page.goto(origin + `/${switchedLocale}/`);
          await history().click();
          await expect(historyDialog.locator("li")).toHaveCount(1);
          await expect(
            historyDialog.getByRole("link", { name: entry.edition_utc }),
          ).toHaveCount(0);
          await closeHistory();
          assert.equal(
            await page.evaluate(
              (hash) =>
                Object.hasOwn(
                  JSON.parse(sessionStorage.getItem("onebox:v1:public-cache"))
                    .puzzles,
                  hash,
                ),
              entry.sha256,
            ),
            false,
          );
          // A known withdrawn payload must not reappear through cache fallback.
          assert.equal((await page.goto(origin + path)).status(), 410);
          assert.equal(
            (await fetch(origin + "/ja/p/onebox-2099-01-01/")).status,
            404,
          );
          assert.equal((await fetch(origin + entry.payload_url)).status, 404);
          assert.equal(
            (await fetch(origin + "/.LOCAL_SIMULATION")).status,
            404,
          );
          assert.deepEqual(
            errors,
            [],
            `${name} ${locale}: unexpected page errors`,
          );
          lines.push(
            `${name} ${locale}: past fixed URL/hash, offline completion across changes, sharing, cross-edition history with pause/focus and six widths, multi-payload cache, missing cache blocks, payload network fallback, corrupt payload blocks, recall prunes cache/history, withdrawn410/unknown404 PASS`,
          );
          console.log(`${name} ${locale} daily checks passed`);
          await switchManifest(original);
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
  // Future bundle preparation and rollback remain local: data/page first, manifest last.
  const fixtures = JSON.parse(
    await readFile("examples/verified_fixture_batch.json", "utf8"),
  );
  const puzzle = validatePuzzle({
    ...fixtures[2].puzzle,
    puzzle_id: "onebox-2026-10-18",
    purpose: "production_daily",
  });
  const sha256 = await hashPuzzle(puzzle),
    entry = {
      ...original.active,
      puzzle_id: puzzle.puzzle_id,
      slug: puzzle.puzzle_id,
      sha256,
      payload_url: `/puzzles/${sha256}.json`,
      edition_utc: "2026-10-18",
      opens_at: "2026-10-18T00:00:00.000Z",
      scheduled_close_at: "2026-10-19T00:00:00.000Z",
    };
  await writeFile(root + entry.payload_url, canonical(puzzle));
  for (const locale of ["ja", "en"]) {
    const path = `/${locale}/p/${entry.slug}/`;
    await mkdir(root + path, { recursive: true });
    await cp(`${root}/${locale}/index.html`, root + path + "index.html");
  }
  assert.equal((await fetch(origin + entry.payload_url)).status, 404);
  await switchManifest({
    ...original,
    active: entry,
    recent: [entry, ...original.recent],
    published_at: "2026-10-18T00:00:01.000Z",
    next_update_at: "2026-10-19T00:00:00.000Z",
  });
  for (const e of [entry, ...original.recent]) {
    assert.equal((await fetch(origin + `/ja/p/${e.slug}/`)).status, 200);
    assert.equal(
      await (await fetch(origin + e.payload_url)).text(),
      await readFile(root + e.payload_url, "utf8"),
    );
  }
  await switchManifest(original);
  assert.equal((await fetch(origin + `/ja/p/${entry.slug}/`)).status, 404);
  assert.equal(
    (await fetch(origin + `/ja/p/${original.recent[1].slug}/`)).status,
    200,
  );
  lines.push(
    "Local assets-before-manifest switch/rollback preserves past URLs; unlisted prepared payload remains404 PASS. Synthetic fixtures only; no real quality approval, job or production publication.",
  );
  await writeFile(`${evidenceDir}/daily-preview.txt`, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
} finally {
  const stopped = once(child, "exit");
  child.kill("SIGTERM");
  await stopped;
  await rm(root, { recursive: true, force: true });
}
