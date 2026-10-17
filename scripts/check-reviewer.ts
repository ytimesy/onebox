import { chromium, firefox, webkit, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  PrivateStore,
  privateRoot,
} from "../packages/puzzle-tools/private-store.ts";
import { createReviewerServer } from "../packages/puzzle-tools/reviewer-server.ts";
import { generate, digest } from "../packages/puzzle-tools/generator.ts";
import {
  importBatch,
  validateTrial,
  type Trial,
} from "../packages/puzzle-tools/curation.ts";
import type { Placement, Puzzle } from "../packages/game-core/index.ts";

// All browser confirmations below are synthetic and confined to a disposable catalog.
const workspace = "test-review-browser-" + randomUUID().slice(0, 16);
const store = new PrivateStore(workspace),
  main = new PrivateStore();
const mainBefore = digest(await main.read());
const batch = generate({ seed: 12345, count: 2 });
assert.equal(batch.complete, true);
await store.mutate((c) =>
  importBatch(
    c,
    batch,
    "test-generated",
    "automated-test",
    new Date().toISOString(),
  ),
);
const before = digest(await store.read());
const server = createReviewerServer(
  store,
  resolve(process.env.ONEBOX_REVIEW_CHECK_ROOT ?? "var/reviewer"),
);
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const lines: string[] = [];
let importReport: Trial | undefined;
async function choose(page: Page, id: string) {
  await page.goto(origin);
  await page.locator(".review-panel select").first().selectOption(id);
  await page.getByRole("button", { name: "箱を開く" }).click();
  await page.locator(".board").waitFor();
}
async function place(page: Page, q: Placement, p: Puzzle) {
  await page.locator(`[data-piece="${q.piece_id}"]`).click();
  const initial = p.pieces.find((s) => s.id === q.piece_id)!.initial_rotation;
  for (let i = 0; i < (q.rotation - initial + 4) % 4; i++)
    await page.getByRole("button", { name: "回転", exact: false }).click();
  await page.locator(`[data-cell="${q.x},${q.y}"]`).click();
  await page.getByRole("button", { name: "置く", exact: false }).click();
}
async function exportCurrent(page: Page) {
  await page
    .getByRole("button", { name: /^(この試遊を記録|終了して試遊を記録)$/ })
    .click();
  const button = page.getByRole("button", {
    name: "JSONを書き出す",
    exact: true,
  });
  assert.equal(await button.isDisabled(), true);
  await page
    .getByRole("checkbox", { name: "実際に自分が操作した結果", exact: false })
    .check();
  const pending = page.waitForEvent("download");
  await button.click();
  const download = await pending;
  const stream = await download.createReadStream();
  assert.ok(stream);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return validateTrial(JSON.parse(Buffer.concat(chunks).toString()));
}
try {
  const privateEvidence = `${privateRoot}/reviewer-evidence`;
  await mkdir(privateEvidence, { recursive: true, mode: 0o700 });
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage(),
        errors: string[] = [],
        responses: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", (r) => responses.push(r.url()));
      const first = batch.candidates[0],
        second = batch.candidates[1];
      await choose(page, first.puzzle.puzzle_id);
      const inventoryPanel = page.getByRole("region", {
        name: "在庫と試遊集計",
        exact: true,
      });
      await inventoryPanel
        .getByText("要対応：公開待ちが7問未満", { exact: true })
        .waitFor();
      assert.match(
        (await inventoryPanel.getByTestId("ready-stock").textContent()) ?? "",
        /公開待ち：0問/,
      );
      const firstSummary = inventoryPanel.getByRole("region", {
        name: "初回集計",
        exact: true,
      });
      assert.match(
        (await firstSummary.textContent()) ?? "",
        /開始0件.*完了0件.*未完了0件/,
      );
      assert.match((await firstSummary.textContent()) ?? "", /完了率未計測/);
      lines.push(
        `${name}: no accepted stock and no reports shown as action required / unknown PASS`,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "操作を試す", exact: false })
          .count(),
        0,
      );
      for (const q of first.construction) await place(page, q, first.puzzle);
      await page
        .getByRole("heading", { name: "ぴったり！", exact: true })
        .waitFor();
      const completed = await exportCurrent(page);
      assert.equal(completed.outcome, "completed");
      assert.equal(completed.attempt_mode, "first");
      assert.equal(completed.device, "desktop");
      assert.equal(completed.hint_count, 0);
      assert.equal(completed.interrupted, false);
      assert.equal(completed.first_piece_placed, true);
      importReport ??= completed;
      lines.push(`${name}: completion and confirmed strict report PASS`);
      await page
        .getByRole("button", { name: "もう一度練習", exact: false })
        .click();
      const practice = await exportCurrent(page);
      assert.equal(practice.outcome, "unfinished");
      assert.equal(practice.attempt_mode, "practice");
      assert.equal(practice.interrupted, true);
      assert.equal(
        await page
          .getByRole("button", { name: "続きを遊ぶ", exact: false })
          .count(),
        0,
        "recorded unfinished trial must not resume with the same ID",
      );
      assert.match(
        (await page
          .getByRole("region", { name: "試遊の下書き", exact: true })
          .textContent()) ?? "",
        /2件/,
      );
      lines.push(
        `${name}: unfinished practice and first denominator preserved PASS`,
      );

      // A separate context isolates first attempts, just as a different trial browser does.
      const other = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      });
      const phoneLayout = await other.newPage();
      phoneLayout.on("pageerror", (e) => errors.push(e.message));
      await choose(phoneLayout, second.puzzle.puzzle_id);
      await place(phoneLayout, second.construction[0], second.puzzle);
      await phoneLayout
        .getByRole("button", { name: "取消", exact: false })
        .click();
      await phoneLayout
        .getByRole("button", { name: "ヒント", exact: false })
        .click();
      await phoneLayout
        .locator('[role="status"]')
        .filter({ hasText: "置き場所" })
        .first()
        .waitFor();
      const unfinished = await exportCurrent(phoneLayout);
      assert.equal(unfinished.outcome, "unfinished");
      assert.equal(unfinished.hint_count, 1);
      assert.equal(unfinished.first_piece_placed, true);
      assert.equal(
        unfinished.device,
        "desktop",
        "emulation must not claim a real phone",
      );
      lines.push(
        `${name}: undo retains first placement, hint and unfinished report PASS`,
      );
      await phoneLayout.reload();
      await phoneLayout
        .locator(".review-panel select")
        .first()
        .selectOption(second.puzzle.puzzle_id);
      await phoneLayout
        .getByRole("status")
        .filter({ hasText: "未完了で終了" })
        .waitFor();
      assert.match(
        (await phoneLayout
          .getByRole("region", { name: "試遊の下書き", exact: true })
          .textContent()) ?? "",
        /1件/,
      );
      await phoneLayout
        .getByRole("button", { name: "Language", exact: true })
        .click();
      await phoneLayout
        .getByRole("button", { name: "Practice again", exact: false })
        .click();
      await phoneLayout
        .getByRole("button", { name: "Pause", exact: false })
        .click();
      await phoneLayout.reload();
      await phoneLayout
        .locator(".review-panel select")
        .first()
        .selectOption(second.puzzle.puzzle_id);
      await phoneLayout
        .getByRole("button", { name: "続きを遊ぶ", exact: false })
        .waitFor();
      await phoneLayout
        .getByRole("button", { name: "Language", exact: true })
        .click();
      await phoneLayout
        .getByRole("button", { name: "Continue", exact: false })
        .click();
      phoneLayout.once("dialog", (d) => d.accept());
      await phoneLayout
        .getByRole("button", { name: "Show solution", exact: false })
        .click();
      await phoneLayout
        .getByRole("heading", { name: "Solution shown", exact: true })
        .waitFor();
      await phoneLayout
        .getByRole("button", { name: "Record this trial", exact: true })
        .click();
      const reportDialog = phoneLayout.locator(".review-report");
      await reportDialog.waitFor();
      assert.match((await reportDialog.textContent()) ?? "", /未完了/);
      assert.match((await reportDialog.textContent()) ?? "", /言語en/);
      assert.match((await reportDialog.textContent()) ?? "", /配置なし/);
      await reportDialog
        .getByRole("button", { name: "閉じる", exact: true })
        .click();
      lines.push(
        `${name}: reload recovery, English and answer-as-unfinished PASS`,
      );
      for (const width of [320, 390, 768, 1440]) {
        await phoneLayout.setViewportSize({ width, height: 844 });
        assert.ok(
          await phoneLayout.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await phoneLayout.screenshot({
          path: `${privateEvidence}/${name}-${width}.png`,
          fullPage: true,
        });
      }
      assert.ok(responses.every((url) => url.startsWith(origin + "/")));
      assert.deepEqual(errors, []);
      lines.push(
        `${name}: 320/390/768/1440 layouts and local-only requests PASS`,
      );
      await context.close();
      await other.close();
    } finally {
      await browser.close();
    }
  }
  assert.equal(
    digest(await store.read()),
    before,
    "browser must never write curation automatically",
  );
  assert.ok(importReport);
  const reportFile = `${store.dir}/synthetic-export.json`;
  await writeFile(reportFile, JSON.stringify(importReport), { mode: 0o600 });
  const id = batch.candidates[0].puzzle.puzzle_id;
  for (const args of [
    ["start-trial", "--id", id, "--actor", "automated-test"],
    [
      "record-trial",
      "--id",
      id,
      "--actor",
      "automated-test",
      "--report",
      reportFile,
    ],
  ])
    execFileSync(
      process.execPath,
      [
        "packages/puzzle-tools/curation-cli.ts",
        ...args,
        "--workspace",
        workspace,
      ],
      { stdio: "pipe", timeout: 10000 },
    );
  assert.equal((await store.read()).entries[0].trials.length, 1);
  lines.push("Export -> CLI import PASS (synthetic disposable catalog only)");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(origin);
    const panel = page.getByRole("region", {
      name: "在庫と試遊集計",
      exact: true,
    });
    await panel
      .getByText("要対応：公開待ちが7問未満", { exact: true })
      .waitFor();
    const firstSummary = panel.getByRole("region", {
      name: "初回集計",
      exact: true,
    });
    assert.match(
      (await firstSummary.textContent()) ?? "",
      /開始1件.*完了1件.*未完了0件/,
    );
    assert.match((await firstSummary.textContent()) ?? "", /完了率100\.0%/);
    // A read-only refresh reflects subsequent CLI writes without replacing the puzzle.
    const secondReport = {
      ...importReport,
      trial_id: "synthetic-stock-refresh",
      outcome: "unfinished",
      interrupted: true,
    };
    await writeFile(reportFile, JSON.stringify(secondReport), { mode: 0o600 });
    execFileSync(
      process.execPath,
      [
        "packages/puzzle-tools/curation-cli.ts",
        "record-trial",
        "--id",
        id,
        "--actor",
        "automated-test",
        "--report",
        reportFile,
        "--workspace",
        workspace,
      ],
      { stdio: "pipe", timeout: 10000 },
    );
    await panel.getByRole("button", { name: "在庫を再確認" }).click();
    await firstSummary
      .getByText("完了率50.0% · 未完了率50.0%", { exact: true })
      .waitFor();
    assert.match(
      (await firstSummary.textContent()) ?? "",
      /開始2件.*完了1件.*未完了1件/,
    );
    assert.match(
      (await panel
        .getByRole("region", { name: "スマートフォン初回集計", exact: true })
        .textContent()) ?? "",
      /開始0件/,
    );
    // Never leave a previous good count visible after a failed refresh.
    await page.route("**/api/inventory", (route) =>
      route.fulfill({ status: 503, body: "" }),
    );
    await panel.getByRole("button", { name: "在庫を再確認" }).click();
    await panel.getByRole("alert").waitFor();
    assert.equal(await panel.getByTestId("ready-stock").count(), 0);
    await page.unroute("**/api/inventory");
    await panel.getByRole("button", { name: "在庫を再確認" }).click();
    await firstSummary
      .getByText("完了率50.0% · 未完了率50.0%", { exact: true })
      .waitFor();
    lines.push(
      "Inventory refresh after synthetic CLI report, failure hides stale counts, recovery PASS",
    );
  } finally {
    await browser.close();
  }
  assert.equal(
    digest(await main.read()),
    mainBefore,
    "real catalog must remain unchanged",
  );
  lines.push(
    "Actual catalog unchanged; all reports above are automated tests, not human evidence.",
  );
  await writeFile("evidence/t22-reviewer-browser.txt", lines.join("\n") + "\n");
  console.log(lines.join("\n"));
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  await rm(store.dir, { recursive: true, force: true });
}
