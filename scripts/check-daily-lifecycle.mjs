import { chromium, firefox, webkit, expect } from "@playwright/test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  cp,
  readFile,
  writeFile,
  mkdir,
  rename,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { twoDayRehearsal } from "../tests/helpers/daily-lifecycle.ts";
import { reviewSyntheticStock } from "../tests/helpers/quality-catalog.ts";
import { prepareDaily } from "../packages/puzzle-tools/daily.ts";
import { solve } from "../packages/game-core/solver.ts";
const evidence = resolve(
  process.env.ONEBOX_LIFECYCLE_EVIDENCE ?? "evidence/daily-lifecycle-check",
);
await mkdir(evidence, { recursive: true });
const temp = await realpath(
  await mkdtemp(join(tmpdir(), "onebox-daily-lifecycle-browser-")),
);
let child;
try {
  const { store, catalog, second } = await twoDayRehearsal(
    join(temp, "transactions"),
  );
  const delayed = await store.markDelayed(
    "2026-10-17T00:00:01.000Z",
    second.hash,
    "test",
    "Synthetic delayed delivery",
  );
  const fallback = await store.recall(
    "onebox-2026-10-16",
    "2026-10-17T00:00:02.000Z",
    delayed.hash,
    "test",
    "Synthetic current recall",
  );
  const unavailable = await store.recall(
    "onebox-2026-10-15",
    "2026-10-17T00:00:03.000Z",
    fallback.hash,
    "test",
    "Synthetic final recall",
  );
  const reviewed = reviewSyntheticStock(
    structuredClone(unavailable.state.catalog),
    "2026-10-17T00:00:04.000Z",
  );
  const fresh = await store.refreshCatalog(
    reviewed,
    "2026-10-17T00:00:04.000Z",
    unavailable.hash,
    "test",
    "Explicit synthetic editorial re-review",
  );
  const plan = prepareDaily(
    fresh.state.catalog,
    catalog.entries[2].puzzle.puzzle_id,
    "2026-10-17",
    "2026-10-17T00:00:05.000Z",
    fresh.state.manifest,
  );
  const recovered = await store.commit(
    plan,
    "2026-10-17T00:00:05.000Z",
    fresh.hash,
  );
  const root = join(temp, "web");
  await mkdir(root);
  await cp(resolve("evidence/daily-preview/assets"), join(root, "assets"), {
    recursive: true,
  });
  await writeFile(
    join(root, ".LOCAL_SIMULATION"),
    "ONEBOX synthetic daily preview v1\n",
  );
  for (const locale of ["ja", "en"]) {
    const html = await readFile(
      resolve("evidence/daily-preview", locale, "index.html"),
      "utf8",
    );
    for (const path of [
      `/${locale}/`,
      ...recovered.state.catalog.history.items.map(
        (h) => `/${locale}/p/${h.puzzle.puzzle_id}/`,
      ),
    ]) {
      await mkdir(root + path, { recursive: true });
      await writeFile(root + path + "index.html", html);
    }
  }
  await mkdir(join(root, "puzzles"));
  async function publish(snapshot) {
    if (snapshot.archive) {
      await mkdir(join(root, "archives"), { recursive: true });
      await writeFile(
        root + snapshot.state.manifest.archive.url,
        JSON.stringify(snapshot.archive),
      );
    }
    for (const [hash, body] of Object.entries(snapshot.state.payloads))
      await writeFile(join(root, "puzzles", hash + ".json"), body);
    await writeFile(
      join(root, "release.next"),
      JSON.stringify(snapshot.state.manifest),
    );
    await rename(join(root, "release.next"), join(root, "release.json"));
  }
  await publish(second);
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
  const firstEntry = second.state.manifest.recent[1],
    firstPuzzle = JSON.parse(second.state.payloads[firstEntry.sha256]);
  async function complete(page, puzzle, ja) {
    for (const q of solve(puzzle).solutions[0]) {
      await page.locator(`[data-piece="${q.piece_id}"]`).tap();
      const initial = puzzle.pieces.find(
        (p) => p.id === q.piece_id,
      ).initial_rotation;
      for (let i = 0; i < (q.rotation - initial + 4) % 4; i++)
        await page
          .getByRole("button", { name: ja ? "回転" : "Rotate", exact: false })
          .tap();
      await page.locator(`[data-cell="${q.x},${q.y}"]`).tap();
      await page
        .locator(".controls")
        .getByRole("button", { name: ja ? "置く" : "Place", exact: false })
        .tap();
    }
    await expect(
      page.getByRole("heading", {
        name: ja ? "ぴったり！" : "A perfect fit!",
        exact: true,
      }),
    ).toBeVisible();
  }
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await engine.launch();
    try {
      for (const locale of ["ja", "en"]) {
        const ja = locale === "ja",
          context = await browser.newContext({
            hasTouch: true,
            viewport: { width: 390, height: 844 },
          }),
          probe = await browser.newContext({
            hasTouch: true,
            viewport: { width: 390, height: 844 },
          });
        const page = await context.newPage(),
          other = await probe.newPage(),
          errors = [];
        for (const p of [page, other])
          p.on("pageerror", (e) => errors.push(e.message));
        try {
          await publish(second);
          await page.goto(origin + `/${locale}/p/${firstEntry.slug}/`);
          await page
            .getByRole("button", {
              name: ja ? "箱を開く" : "Open the box",
              exact: false,
            })
            .tap();
          await expect(page.locator(".puzzle-id")).toContainText(
            firstEntry.puzzle_id,
          );
          await publish(delayed);
          await publish(fallback);
          const removed = await other.goto(
            origin + `/${locale}/p/onebox-2026-10-16/`,
          );
          assert.equal(removed.status(), 410);
          await expect(
            other.getByText(
              ja
                ? "この問題は公開を取り下げました。"
                : "This puzzle has been withdrawn.",
              { exact: true },
            ),
          ).toBeVisible();
          const back = other.getByRole("link", {
            name: ja ? "トップへ戻る" : "Back to ONEBOX",
          });
          assert.ok((await back.boundingBox()).height >= 44);
          await back.click();
          await expect(
            other.getByText(
              ja ? "新しい挑戦は練習" : "New attempts are practice",
              { exact: false },
            ),
          ).toBeVisible();
          await other
            .getByRole("button", {
              name: ja ? "箱を開く" : "Open the box",
              exact: false,
            })
            .tap();
          await expect(other.locator(".puzzle-id")).toContainText(
            ja ? "練習" : "Practice",
          );
          const old = await other.evaluate(
            (id) => JSON.parse(localStorage.getItem(`onebox:v1:current:${id}`)),
            firstEntry.puzzle_id,
          );
          assert.equal(old.mode, "practice");
          await publish(unavailable);
          assert.equal((await other.reload()).status(), 503);
          await expect(
            other.getByText(
              ja
                ? "現在遊べる日次問題はありません。時間をおいて再確認してください。"
                : "No daily puzzle is currently available. Please check again later.",
              { exact: true },
            ),
          ).toBeVisible();
          await expect(other.locator(".board")).toHaveCount(0);
          await expect(
            other.getByRole("button", {
              name: ja ? "箱を開く" : "Open the box",
              exact: false,
            }),
          ).toHaveCount(0);
          const retry = other.getByRole("button", {
            name: ja ? "もう一度読み込む" : "Try again",
            exact: true,
          });
          await expect(retry).toBeVisible();
          assert.equal(
            await other.evaluate(
              () =>
                Object.keys(
                  JSON.parse(sessionStorage.getItem("onebox:v1:public-cache"))
                    .puzzles,
                ).length,
            ),
            0,
          );
          for (const width of [320, 390, 768, 1440]) {
            await other.setViewportSize({ width, height: 844 });
            assert.equal(
              await other.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
              true,
            );
            if (width === 390 && name === "chromium" && ja)
              await other.screenshot({
                path: join(evidence, "unavailable-ja-390.png"),
              });
          }
          for (const e of second.state.manifest.recent) {
            assert.equal(
              (await fetch(origin + `/${locale}/p/${e.slug}/`)).status,
              410,
            );
            assert.equal((await fetch(origin + e.payload_url)).status, 404);
          }
          // A loaded run remains pinned and can finish offline after server controls.
          await context.setOffline(true);
          await complete(page, firstPuzzle, ja);
          const first = await page.evaluate(
            (id) => JSON.parse(localStorage.getItem(`onebox:v1:current:${id}`)),
            firstEntry.puzzle_id,
          );
          assert.equal(first.mode, "first");
          assert.equal(first.puzzle_hash, firstEntry.sha256);
          assert.equal(first.state, "completed");
          await publish(recovered);
          await retry.click();
          await expect(
            other.getByRole("button", {
              name: ja ? "箱を開く" : "Open the box",
              exact: false,
            }),
          ).toBeVisible();
          await other
            .getByRole("button", {
              name: ja ? "直近7回の記録" : "Last 7 attempts",
              exact: true,
            })
            .click();
          await expect(other.locator(".recent-dialog li")).toHaveCount(0);
          await other
            .locator(".recent-dialog")
            .getByRole("button", {
              name: ja ? "問題に戻る" : "Back to the puzzle",
              exact: true,
            })
            .click();
          assert.equal(
            await other.evaluate(
              (id) =>
                JSON.parse(localStorage.getItem(`onebox:v1:current:${id}`))
                  .run_id,
              firstEntry.puzzle_id,
            ),
            old.run_id,
          );
          await other
            .getByRole("button", {
              name: ja ? "箱を開く" : "Open the box",
              exact: false,
            })
            .tap();
          const newPuzzle = JSON.parse(plan.payload_json);
          await complete(other, newPuzzle, ja);
          const saved = await other.evaluate(
            (id) => JSON.parse(localStorage.getItem(`onebox:v1:current:${id}`)),
            newPuzzle.puzzle_id,
          );
          assert.equal(saved.mode, "first");
          assert.equal(saved.puzzle_hash, plan.manifest.active.sha256);
          assert.deepEqual(errors, []);
          lines.push(
            `${name} ${locale}: two published days/hash, localized410/back link44px, delayed practice, all-recalled503/retry/cache purge/four widths, preserved offline first completion, new accepted day recovery/new first, withdrawn records retained and excluded PASS`,
          );
          console.log(`${name} ${locale} daily lifecycle passed`);
        } finally {
          await context.close();
          await probe.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
  for (const path of [
    "/snapshot.PRIVATE.json",
    "/.LOCAL_DAILY",
    "/api/candidates",
  ])
    assert.equal((await fetch(origin + path)).status, 404);
  lines.push(
    "All data came from actual LOCAL rehearsal snapshots with explicit synthetic review actions. Real catalog/publication/jobs untouched; 30-puzzle gate retained.",
  );
  await writeFile(join(evidence, "lifecycle.log"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
} finally {
  if (child) {
    const stopped = once(child, "exit");
    child.kill("SIGTERM");
    await stopped;
  }
  await rm(temp, { recursive: true, force: true });
}
