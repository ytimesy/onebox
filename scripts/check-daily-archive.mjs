import { chromium, firefox, webkit, expect } from "@playwright/test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  mkdir,
  cp,
  readFile,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { longHistoryRehearsal } from "../tests/helpers/long-history.ts";
import { canonical } from "../packages/game-core/index.ts";
import { solve } from "../packages/game-core/solver.ts";
const evidence = resolve(
  process.env.ONEBOX_ARCHIVE_EVIDENCE ?? "evidence/daily-archive-check",
);
await mkdir(evidence, { recursive: true });
const temp = await realpath(
  await mkdtemp(join(tmpdir(), "onebox-archive-browser-")),
);
let child;
try {
  const { store, current, oldest } = await longHistoryRehearsal(
    join(temp, "state"),
  );
  const withdrawn = await store.recall(
    oldest.puzzle_id,
    "2026-10-19T00:00:01.000Z",
    current.hash,
    "test",
    "Synthetic archived withdrawal, never main",
  );
  const root = join(temp, "web");
  await cp(current.publicRoot, root, { recursive: true });
  await cp(resolve("evidence/daily-preview/assets"), join(root, "assets"), {
    recursive: true,
  });
  for (const locale of ["ja", "en"]) {
    await mkdir(join(root, locale));
    await cp(
      resolve("evidence/daily-preview", locale, "index.html"),
      join(root, locale, "index.html"),
    );
  }
  await writeFile(
    join(root, ".LOCAL_SIMULATION"),
    "ONEBOX synthetic daily preview v1\n",
  );
  async function publish(snapshot) {
    await writeFile(
      join(root, "release.next"),
      canonical(snapshot.state.manifest),
    );
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
  assert.equal(current.state.catalog.history.total_released, 182);
  assert.equal(current.state.manifest.recent.length, 180);
  assert.equal(current.archive.entries.length, 182);
  const puzzle = JSON.parse(current.state.payloads[oldest.sha256]);
  const engines = { chromium, firefox, webkit },
    selected = process.env.ONEBOX_ARCHIVE_ENGINE;
  if (selected && !Object.hasOwn(engines, selected))
    throw Error("Unknown archive engine");
  for (const [name, engine] of Object.entries(engines).filter(
    ([name]) => !selected || name === selected,
  )) {
    const browser = await engine.launch();
    try {
      for (const locale of ["ja", "en"]) {
        await publish(current);
        const ja = locale === "ja",
          context = await browser.newContext({
            hasTouch: true,
            viewport: { width: 390, height: 844 },
          }),
          page = await context.newPage(),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const open = (page) =>
          page.getByRole("button", {
            name: ja ? "箱を開く" : "Open the box",
            exact: false,
          });
        const history = (page) =>
          page.getByRole("button", {
            name: ja ? "直近7回の記録" : "Last 7 attempts",
            exact: true,
          });
        const run = (page) =>
          page.evaluate(
            (id) => JSON.parse(localStorage.getItem(`onebox:v1:current:${id}`)),
            oldest.puzzle_id,
          );
        async function complete(page) {
          for (const q of solve(puzzle).solutions[0]) {
            await page.locator(`[data-piece="${q.piece_id}"]`).tap();
            const r = puzzle.pieces.find(
              (p) => p.id === q.piece_id,
            ).initial_rotation;
            for (let i = 0; i < (q.rotation - r + 4) % 4; i++)
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
        try {
          const path = `/${locale}/p/${oldest.slug}/?src=share`;
          assert.equal((await page.goto(origin + path)).status(), 200);
          await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
            "href",
            origin + path.split("?")[0],
          );
          await expect(open(page)).toBeEnabled();
          await open(page).tap();
          await expect(page.locator(".puzzle-id")).toContainText(
            oldest.puzzle_id,
          );
          const initial = await run(page);
          assert.equal(initial.mode, "first");
          assert.equal(initial.puzzle_hash, oldest.sha256);
          await complete(page);
          const first = await run(page);
          assert.equal(first.state, "completed");
          await page
            .getByRole("button", {
              name: ja ? "Xに投稿" : "Post to X",
              exact: true,
            })
            .tap();
          const text = await page
            .locator(".share-dialog textarea")
            .inputValue();
          assert.ok(text.endsWith(origin + path));
          assert.ok(!text.includes(first.run_id));
          await page
            .locator(".share-dialog")
            .getByRole("button", { name: ja ? "閉じる" : "Close", exact: true })
            .tap();
          await page.goto(origin + `/${locale}/`);
          await open(page).tap();
          await expect(page.locator(".puzzle-id")).toContainText(
            current.state.manifest.active.puzzle_id,
          );
          await history(page).tap();
          await expect(page.locator(".recent-dialog li")).toHaveCount(2);
          await expect(
            page
              .locator(".recent-dialog")
              .getByRole("link", { name: oldest.edition_utc }),
          ).toHaveAttribute("href", `/${locale}/p/${oldest.slug}/`);
          for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 844 });
            assert.equal(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
              true,
            );
            if (name === "chromium" && ja && width === 390)
              await page.screenshot({
                path: join(evidence, "history-archive-390.png"),
              });
          }
          await page
            .locator(".recent-dialog")
            .getByRole("button", {
              name: ja ? "問題に戻る" : "Back to the puzzle",
              exact: true,
            })
            .tap();
          // Serve the HTML/assets normally; only publication data is unavailable.
          await page.route("**/release.json", (route) =>
            route.fulfill({ status: 503, body: "Unavailable" }),
          );
          await page.goto(origin + path);
          await page
            .getByRole("button", {
              name: ja ? "もう一度練習" : "Practice again",
              exact: false,
            })
            .tap();
          await expect(page.locator(".puzzle-id")).toContainText(
            ja ? "練習" : "Practice",
          );
          assert.equal((await run(page)).puzzle_hash, oldest.sha256);
          await context.setOffline(true);
          await complete(page);
          await context.setOffline(false);
          await page.unroute("**/release.json");
          assert.deepEqual(
            await page.evaluate(
              (id) => JSON.parse(localStorage.getItem(`onebox:v1:run:${id}`)),
              first.run_id,
            ),
            first,
          );
          // Fresh contexts cannot authorize an archived edition from an invalid index.
          const probe = await browser.newContext({
              hasTouch: true,
              viewport: { width: 390, height: 844 },
            }),
            other = await probe.newPage();
          other.on("pageerror", (e) => errors.push(e.message));
          try {
            await other.route("**/archives/*.json", (route) =>
              route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                  ...current.archive,
                  entries: [...current.archive.entries].reverse(),
                }),
              }),
            );
            await other.goto(origin + path);
            await expect(
              other.getByText(
                ja ? "問題を読み込めませんでした" : "Could not load the puzzle",
                { exact: false },
              ),
            ).toBeVisible();
            await expect(open(other)).toHaveCount(0);
            await other.unroute("**/archives/*.json");
            await other.route("**/archives/*.json", (route) =>
              route.fulfill({ status: 404, body: "{}" }),
            );
            const unavailableIndex = other.waitForResponse(
              (r) => r.url().includes("/archives/") && r.status() === 404,
            );
            await other
              .getByRole("button", {
                name: ja ? "もう一度読み込む" : "Try again",
                exact: true,
              })
              .tap();
            await unavailableIndex;
            await expect(
              other.getByText(
                ja ? "問題を読み込めませんでした" : "Could not load the puzzle",
                { exact: false },
              ),
            ).toBeVisible();
            await expect(open(other)).toHaveCount(0);
            await other.unroute("**/archives/*.json");
            await other
              .getByRole("button", {
                name: ja ? "もう一度読み込む" : "Try again",
                exact: true,
              })
              .tap();
            await expect(open(other)).toBeEnabled();
            await publish(withdrawn);
            await open(other).tap();
            await expect(other.getByRole("alert")).toContainText(
              ja ? "公開を取り下げました" : "has been withdrawn",
            );
            assert.equal(await run(other), null);
            assert.equal((await other.reload()).status(), 410);
            await expect(
              other.getByRole("link", {
                name: ja ? "トップへ戻る" : "Back to ONEBOX",
              }),
            ).toBeVisible();
            assert.equal(
              (await fetch(origin + oldest.payload_url)).status,
              404,
            );
          } finally {
            await probe.close();
          }
          await page.goto(origin + `/${locale}/`);
          await history(page).tap();
          await expect(page.locator(".recent-dialog li")).toHaveCount(1);
          assert.deepEqual(
            await page.evaluate(
              (id) => JSON.parse(localStorage.getItem(`onebox:v1:run:${id}`)),
              first.run_id,
            ),
            first,
          );
          assert.deepEqual(errors, []);
          lines.push(
            `${name} ${locale}: 182 published/180 recent, oldest fixed URL/hash/first completion/share, cross-archive history/four widths, verified offline practice, bad index/404 stop and retry, archived withdrawal410/payload404/history exclusion with original result retained PASS`,
          );
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
    } finally {
      await browser.close();
    }
  }
  for (const path of [
    "/snapshot.PRIVATE.json",
    "/api/candidates",
    "/archives/not-published.json",
    "/ja/p/onebox-2030-01-01/",
  ])
    assert.equal((await fetch(origin + path)).status, 404);
  await writeFile(
    join(evidence, "archive-browser-results.log"),
    lines.join("\n") +
      "\nSynthetic history only. Real quality stock, catalog, production daily and jobs unchanged.\n",
  );
} finally {
  if (child) {
    const stopped = once(child, "exit");
    child.kill("SIGTERM");
    await stopped;
  }
  await rm(temp, { recursive: true, force: true });
}
