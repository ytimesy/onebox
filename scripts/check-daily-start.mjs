import { chromium, firefox, webkit, expect } from "@playwright/test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  cp,
  readFile,
  writeFile,
  rename,
  rm,
  mkdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  canonical,
  hashPuzzle,
  validatePuzzle,
} from "../packages/game-core/index.ts";
import {
  validateManifest,
  recallDaily,
  nextUtcUpdate,
} from "../packages/game-core/release.ts";
import { solve } from "../packages/game-core/solver.ts";
const evidence = resolve(
  process.env.ONEBOX_START_EVIDENCE ?? "evidence/daily-start-check",
);
await mkdir(evidence, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "onebox-daily-start-"));
let child;
try {
  await cp("evidence/daily-preview", root, { recursive: true });
  const original = validateManifest(
      JSON.parse(await readFile(join(root, "release.json"), "utf8")),
    ),
    entry = original.active,
    puzzle = JSON.parse(await readFile(root + entry.payload_url, "utf8")),
    fixtures = JSON.parse(
      await readFile("examples/verified_fixture_batch.json", "utf8"),
    ),
    nextPuzzle = validatePuzzle({
      ...fixtures[2].puzzle,
      puzzle_id: "onebox-2026-10-18",
      purpose: "production_daily",
    }),
    hash = await hashPuzzle(nextPuzzle),
    nextEntry = {
      ...entry,
      puzzle_id: nextPuzzle.puzzle_id,
      slug: nextPuzzle.puzzle_id,
      sha256: hash,
      payload_url: `/puzzles/${hash}.json`,
      edition_utc: "2026-10-18",
      opens_at: "2026-10-18T00:00:00.000Z",
      scheduled_close_at: "2026-10-19T00:00:00.000Z",
    },
    next = validateManifest({
      ...original,
      active: nextEntry,
      recent: [nextEntry, ...original.recent],
      published_at: "2026-10-18T00:00:01.000Z",
      next_update_at: nextUtcUpdate("2026-10-18T00:00:01.000Z"),
    }),
    withdrawn = recallDaily(
      original,
      entry.puzzle_id,
      "2026-10-17T00:00:02.000Z",
    );
  await writeFile(root + nextEntry.payload_url, canonical(nextPuzzle));
  async function publish(manifest) {
    await writeFile(join(root, "release.next"), canonical(manifest));
    await rename(join(root, "release.next"), join(root, "release.json"));
  }
  child = spawn(
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
  const [output] = await once(child.stdout, "data"),
    origin = String(output).match(/http:\/\/127\.0\.0\.1:\d+/)[0],
    lines = [];
  const engines = { chromium, firefox, webkit },
    selectedEngine = process.env.ONEBOX_START_ENGINE;
  if (selectedEngine && !Object.hasOwn(engines, selectedEngine))
    throw Error("Unknown start-check engine");
  for (const [name, engine] of Object.entries(engines).filter(
    ([name]) => !selectedEngine || name === selectedEngine,
  )) {
    const browser = await engine.launch();
    try {
      for (const locale of ["ja", "en"]) {
        const ja = locale === "ja";
        const start = (page) =>
          page.getByRole("button", {
            name: ja ? "箱を開く" : "Open the box",
            exact: false,
          });
        const current = (page) =>
          page.evaluate(
            (id) => JSON.parse(localStorage.getItem(`onebox:v1:current:${id}`)),
            entry.puzzle_id,
          );
        async function noRun(page) {
          assert.equal(await current(page), null);
          assert.equal(
            await page.evaluate(
              (id) =>
                Object.keys(localStorage).some((k) =>
                  k.startsWith(`onebox:v1:first:${id}:`),
                ),
              entry.puzzle_id,
            ),
            false,
          );
        }
        async function complete(page) {
          for (const q of solve(puzzle).solutions[0]) {
            await page.locator(`[data-piece="${q.piece_id}"]`).tap();
            const initial = puzzle.pieces.find(
              (p) => p.id === q.piece_id,
            ).initial_rotation;
            for (let i = 0; i < (q.rotation - initial + 4) % 4; i++)
              await page
                .getByRole("button", {
                  name: ja ? "回転" : "Rotate",
                  exact: false,
                })
                .tap();
            await page.locator(`[data-cell="${q.x},${q.y}"]`).tap();
            await page
              .locator(".controls")
              .getByRole("button", {
                name: ja ? "置く" : "Place",
                exact: false,
              })
              .tap();
          }
          await expect(
            page.getByRole("heading", {
              name: ja ? "ぴったり！" : "A perfect fit!",
              exact: true,
            }),
          ).toBeVisible();
        }
        async function scenario(label, body) {
          await publish(original);
          const context = await browser.newContext({
              hasTouch: true,
              viewport: { width: 390, height: 844 },
            }),
            page = await context.newPage(),
            errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          try {
            await page.goto(origin + `/${locale}/`);
            await expect(start(page)).toBeEnabled();
            await body(page, context);
            assert.deepEqual(errors, []);
            lines.push(`${name} ${locale}: ${label} PASS`);
            console.log(lines.at(-1));
          } catch (e) {
            await page
              .screenshot({
                path: join(evidence, `${name}-${locale}-failed.png`),
              })
              .catch(() => {});
            throw e;
          } finally {
            await context.close();
          }
        }
        await scenario(
          "update before start keeps old ID/hash as practice; verification wait is excluded",
          async (page) => {
            await publish(next);
            await page.clock.install();
            let release, arrived;
            const held = new Promise((r) => (release = r)),
              seen = new Promise((r) => (arrived = r));
            await page.route("**/release.json", async (route) => {
              arrived();
              await held;
              await route.continue().catch(() => {});
            });
            try {
              await start(page).tap();
              await seen;
              await expect(start(page)).toBeDisabled();
              await noRun(page);
              await page.clock.fastForward(4000);
              await noRun(page);
              release();
              await expect(page.locator(".board")).toBeVisible();
              const run = await current(page);
              assert.equal(run.mode, "practice");
              assert.equal(run.puzzle_hash, entry.sha256);
              assert.ok(run.active_elapsed_ms < 1000);
              await expect(
                page.getByText(
                  ja
                    ? "新しい問題が公開されています。"
                    : "A new puzzle is available.",
                  { exact: false },
                ),
              ).toBeVisible();
              const link = page.getByRole("link", {
                name: ja ? "公開中の問題を確認" : "Check available puzzles",
              });
              for (const width of [320, 390, 768, 1440]) {
                await page.setViewportSize({ width, height: 844 });
                assert.equal(
                  await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth,
                  ),
                  true,
                );
                assert.ok((await link.boundingBox()).height >= 44);
              }
              if (name === "chromium" && ja)
                await page.screenshot({
                  path: join(evidence, "updated-ja.png"),
                });
              await complete(page);
              await link.tap();
              await expect(start(page)).toBeEnabled();
              await start(page).tap();
              await expect(page.locator(".puzzle-id")).toContainText(
                nextEntry.puzzle_id,
              );
              const fresh = await page.evaluate(
                (id) =>
                  JSON.parse(localStorage.getItem(`onebox:v1:current:${id}`)),
                nextEntry.puzzle_id,
              );
              assert.equal(fresh.mode, "first");
              assert.equal(fresh.puzzle_hash, hash);
            } finally {
              release();
            }
          },
        );
        await scenario(
          "withdrawal before start blocks without consuming first; rollback and offline never revive a known recall",
          async (page, context) => {
            await publish(withdrawn);
            await start(page).tap();
            await expect(page.getByRole("alert")).toContainText(
              ja ? "公開を取り下げました" : "has been withdrawn",
            );
            await noRun(page);
            await expect(page.locator(".board")).toHaveCount(0);
            await publish(original);
            await start(page).tap();
            await expect(page.getByRole("alert")).toContainText(
              ja ? "公開を取り下げました" : "has been withdrawn",
            );
            await noRun(page);
            await context.setOffline(true);
            await start(page).tap();
            await expect(page.getByRole("alert")).toContainText(
              ja ? "公開を取り下げました" : "has been withdrawn",
            );
            await noRun(page);
            await context.setOffline(false);
            await page.reload();
            await expect(
              page.getByText(
                ja ? "問題を読み込めませんでした" : "Could not load the puzzle",
                { exact: false },
              ),
            ).toBeVisible();
            await expect(start(page)).toHaveCount(0);
            assert.equal(
              await page.evaluate(
                (id) =>
                  JSON.parse(
                    sessionStorage.getItem("onebox:v1:public-cache"),
                  ).manifest.recalled_ids.includes(id),
                entry.puzzle_id,
              ),
              true,
            );
            await noRun(page);
          },
        );
        await scenario(
          "invalid/4xx start checks block; explicit retry starts exactly one first run",
          async (page) => {
            await page.route("**/release.json", (route) =>
              route.fulfill({ status: 404, body: "{}" }),
            );
            await start(page).tap();
            await expect(page.getByRole("alert")).toContainText(
              ja ? "公開状態を確認できませんでした" : "Could not verify",
            );
            await noRun(page);
            await expect(start(page)).toBeEnabled();
            await page.unroute("**/release.json");
            await page.route("**/release.json", (route) =>
              route.fulfill({
                status: 200,
                contentType: "application/json",
                body: "{",
              }),
            );
            await start(page).tap();
            await expect(page.getByRole("alert")).toContainText(
              ja ? "公開状態を確認できませんでした" : "Could not verify",
            );
            await noRun(page);
            await expect(start(page)).toBeEnabled();
            await page.unroute("**/release.json");
            await start(page).tap();
            await expect(page.locator(".board")).toBeVisible();
            assert.equal((await current(page)).mode, "first");
            assert.equal(
              await page.evaluate(
                () =>
                  Object.keys(localStorage).filter((k) =>
                    k.startsWith("onebox:v1:run:"),
                  ).length,
              ),
              1,
            );
          },
        );
        await scenario(
          "transport failure before start yields practice on the same verified puzzle",
          async (page) => {
            await page.route("**/release.json", (route) =>
              route.fulfill({ status: 503, body: "Unavailable" }),
            );
            await start(page).tap();
            await expect(page.locator(".board")).toBeVisible();
            const run = await current(page);
            assert.equal(run.mode, "practice");
            assert.equal(run.puzzle_hash, entry.sha256);
            await expect(
              page.getByText(
                ja ? "新しい挑戦は練習" : "New attempts are practice",
                { exact: false },
              ),
            ).toBeVisible();
          },
        );
        await scenario(
          "existing first resumes/completes offline across withdrawal; rejected practice preserves the completed first",
          async (page, context) => {
            await start(page).tap();
            await expect(page.locator(".board")).toBeVisible();
            const initial = await current(page);
            assert.equal(initial.mode, "first");
            await page
              .getByRole("button", {
                name: ja ? "一時停止" : "Pause",
                exact: false,
              })
              .tap();
            await publish(withdrawn);
            await context.setOffline(true);
            await page
              .getByRole("button", {
                name: ja ? "続きを遊ぶ" : "Continue",
                exact: false,
              })
              .tap();
            await expect(page.locator(".board")).toBeVisible();
            assert.equal((await current(page)).run_id, initial.run_id);
            await complete(page);
            const done = await current(page);
            assert.equal(done.mode, "first");
            assert.equal(done.state, "completed");
            assert.equal(done.puzzle_hash, entry.sha256);
            await context.setOffline(false);
            await page
              .getByRole("button", {
                name: ja ? "もう一度練習" : "Practice again",
                exact: false,
              })
              .tap();
            await expect(page.getByRole("alert")).toContainText(
              ja ? "公開を取り下げました" : "has been withdrawn",
            );
            assert.deepEqual(await current(page), done);
            await expect(
              page.getByRole("button", {
                name: ja ? "Xに投稿" : "Post to X",
                exact: true,
              }),
            ).toHaveCount(0);
          },
        );
        await scenario(
          "clear while start verification is pending cancels creation and permits a later explicit start",
          async (page) => {
            let release, arrived;
            const held = new Promise((r) => (release = r)),
              seen = new Promise((r) => (arrived = r));
            await page.route("**/release.json", async (route) => {
              arrived();
              await held;
              await route.continue().catch(() => {});
            });
            try {
              await start(page).tap();
              await seen;
              await page
                .getByRole("button", {
                  name: ja ? "設定・遊び方" : "Settings & how to play",
                  exact: true,
                })
                .tap();
              page.once("dialog", (dialog) => dialog.accept());
              await page
                .getByRole("button", {
                  name: ja ? "このアプリの記録を消す" : "Delete ONEBOX records",
                  exact: true,
                })
                .tap();
              release();
              await page.unroute("**/release.json");
              await expect(start(page)).toBeEnabled();
              await noRun(page);
              await start(page).tap();
              await expect(page.locator(".board")).toBeVisible();
              assert.equal((await current(page)).mode, "first");
            } finally {
              release();
            }
          },
        );
      }
    } finally {
      await browser.close();
    }
  }
  lines.push(
    "LOCAL synthetic fixtures only. No catalog approval, daily publication or jobs activated. Real devices and OS posting remain unverified.",
  );
  await writeFile(
    join(evidence, "browser-results.log"),
    lines.join("\n") + "\n",
  );
} finally {
  if (child) {
    const stopped = once(child, "exit");
    child.kill("SIGTERM");
    await stopped;
  }
  await rm(root, { recursive: true, force: true });
}
