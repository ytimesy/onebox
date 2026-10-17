import { chromium, firefox, webkit, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { artifactDigest } from "./artifact.mjs";

let origin = process.argv[2],
  child;
const publicCheck = Boolean(origin?.startsWith("https:"));
const before = publicCheck ? null : await artifactDigest("dist-playtest");
if (!origin) {
  child = spawn(process.execPath, [resolve("scripts/static-server.mjs")], {
    env: {
      ...process.env,
      ONEBOX_SERVE_ROOT: resolve("dist-playtest"),
      ONEBOX_PORT: "0",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [data] = await once(child.stdout, "data");
  origin = `http://127.0.0.1:${String(data).match(/:(\d+)/)[1]}`;
}
const solution = JSON.parse(
  await readFile("examples/sample_solution.PRIVATE.json", "utf8"),
).placements;
const lines = [];
try {
  for (const [name, engine] of Object.entries(
    publicCheck ? { chromium } : { chromium, firefox, webkit },
  )) {
    const browser = await engine.launch();
    try {
      for (const locale of ["ja", "en"]) {
        const ja = locale === "ja",
          context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            hasTouch: true,
            timezoneId: ja ? "Asia/Tokyo" : "America/Los_Angeles",
          });
        try {
          const page = await context.newPage(),
            errors = [],
            requests = [];
          page.on("pageerror", (e) => errors.push(e.message));
          page.on("request", (r) => {
            if (r.method() !== "GET") requests.push(r.method() + " " + r.url());
          });
          await page.goto(`${origin}/${locale}/`);
          const history = () =>
            page.getByRole("button", {
              name: ja ? "直近7回の記録" : "Last 7 attempts",
              exact: true,
            });
          const dialog = page.locator(".recent-dialog");
          const close = () =>
            dialog
              .getByRole("button", {
                name: ja ? "固定問題に戻る" : "Back to the fixed puzzle",
              })
              .click();
          await history().click();
          await expect(dialog).toContainText(
            ja ? "まだ記録はありません" : "No attempts saved yet",
          );
          await close();
          await page
            .getByRole("button", {
              name: ja ? "箱を開く" : "Open the box",
              exact: false,
            })
            .click();
          await history().click();
          await expect(dialog.locator("li")).toHaveCount(1);
          await expect(dialog).toContainText(ja ? "未完了" : "Unfinished");
          await expect(dialog).toContainText(ja ? "中断あり" : "Interrupted");
          await close();
          await page
            .getByRole("button", {
              name: ja ? "続きを遊ぶ" : "Continue →",
              exact: false,
            })
            .click();
          await page
            .getByRole("button", { name: ja ? "ヒント" : "Hint", exact: false })
            .click();
          await expect(page.locator(".status")).toContainText(
            ja ? "置き場所" : "highlighted",
          );
          for (const q of solution) {
            await page.locator(`[data-piece="${q.piece_id}"]`).click();
            for (let i = 0; i < q.rotation; i++)
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
          await expect(page.locator(".result")).toBeVisible();
          const readRuns = () =>
            page.evaluate(() =>
              Object.keys(localStorage)
                .filter((k) => k.startsWith("onebox:v1:run:"))
                .map((k) => JSON.parse(localStorage.getItem(k))),
            );
          await expect
            .poll(async () => (await readRuns())[0]?.state)
            .toBe("completed");
          const completed = (await readRuns())[0];
          await history().click();
          await expect(dialog).toContainText(ja ? "完成" : "Completed");
          await expect(dialog).toContainText(ja ? "ヒント: 1" : "Hints: 1");
          await close();
          assert.deepEqual((await readRuns())[0], completed);
          await page.reload();
          await history().click();
          await expect(dialog.locator("li")).toHaveCount(1);
          await close();
          // Synthetic local records exercise the seven-record limit and damaged/foreign
          // boundaries. These never become human reports or private catalog entries.
          await page.evaluate((template) => {
            for (const k of Object.keys(localStorage))
              if (k.startsWith("onebox:v1:run:")) localStorage.removeItem(k);
            for (let i = 0; i < 9; i++) {
              const a = {
                ...template,
                run_id: `synthetic-history-${i}`,
                started_at_client: new Date(
                  Date.UTC(2026, 0, 2, 0, 30) + i * 60000,
                ).toISOString(),
                state:
                  i === 8 ? "revealed" : i === 7 ? "abandoned" : "completed",
                timer_visible: i !== 6,
                clock_status: i === 5 ? "uncertain" : "continuous",
                active_elapsed_ms: 123450,
                hint_count: i,
              };
              localStorage.setItem(
                `onebox:v1:run:${a.run_id}`,
                JSON.stringify(a),
              );
            }
            localStorage.setItem(
              "onebox:v1:run:private",
              JSON.stringify({
                ...template,
                run_id: "private",
                puzzle_id: "private-candidate",
              }),
            );
            localStorage.setItem(
              "onebox:v1:run:fake",
              JSON.stringify({ ...template, run_id: "fake", placements: [] }),
            );
            localStorage.setItem("other-app:record", "keep");
          }, completed);
          await history().click();
          await expect(dialog.locator("li")).toHaveCount(7);
          await expect(dialog.locator("li").nth(0)).toContainText(
            ja ? "解答を表示 · 未完了" : "Solution viewed · Unfinished",
          );
          await expect(dialog.locator("li").nth(1)).toContainText(
            ja ? "未完了" : "Unfinished",
          );
          await expect(dialog.locator("li").nth(2)).toContainText(
            ja ? "時間非表示" : "Time hidden",
          );
          await expect(dialog.locator("li").nth(3)).toContainText(
            ja ? "時計が不確か" : "uncertain clock",
          );
          const displayed = await dialog.innerText();
          assert.ok(
            !/synthetic-history|private-candidate|puzzle_hash|placements|run_id/.test(
              displayed,
            ),
          );
          assert.ok(
            (
              await dialog.locator("li").first().locator("time").innerText()
            ).includes(ja ? "9:38" : "4:38"),
          );
          for (const width of [320, 390, 768, 1440]) {
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
              await page.screenshot({
                path: `evidence/history-${publicCheck ? "public" : "local"}-phone.png`,
              });
          }
          if (name === "chromium" && ja)
            await page.screenshot({
              path: `evidence/history-${publicCheck ? "public" : "local"}.png`,
              fullPage: true,
            });
          await page.keyboard.press("Escape");
          await expect(dialog).not.toBeVisible();
          await expect(history()).toBeFocused();
          await page
            .getByRole("button", {
              name: ja ? "設定・遊び方" : "Settings & how to play",
              exact: false,
            })
            .click();
          await page
            .getByRole("checkbox", {
              name: ja ? "時間を表示" : "Show time",
              exact: false,
            })
            .uncheck();
          await page
            .getByRole("dialog")
            .getByRole("button", { name: ja ? "閉じる" : "Close", exact: true })
            .click();
          await history().click();
          assert.ok(!(await dialog.innerText()).includes("123.5"));
          await close();
          page.once("dialog", (d) => d.accept());
          await page
            .getByRole("button", {
              name: ja ? "設定・遊び方" : "Settings & how to play",
              exact: false,
            })
            .click();
          await page
            .getByRole("button", {
              name: ja ? "このアプリの記録を消す" : "Delete ONEBOX records",
              exact: true,
            })
            .click();
          await history().click();
          await expect(dialog.locator("li")).toHaveCount(0);
          assert.equal(
            await page.evaluate(() => localStorage.getItem("other-app:record")),
            "keep",
          );
          assert.deepEqual(errors, []);
          assert.deepEqual(requests, []);
          lines.push(
            `${name} ${browser.version()} ${locale}: real UI pause/hint/completion/reload; synthetic 7-record/order/timezone/privacy/damage boundaries; hidden time; 4 widths; escape/focus; isolated deletion; no writes to server. PASS`,
          );
          console.log(`${name} ${locale} history passed`);
        } finally {
          await context.close();
        }
        const memory = await browser.newContext();
        try {
          await memory.addInitScript(() => {
            Object.defineProperty(window, "localStorage", {
              get() {
                throw new DOMException("Unavailable", "SecurityError");
              },
            });
          });
          const page = await memory.newPage();
          await page.goto(origin + "/ja/");
          await page
            .getByRole("button", { name: "箱を開く", exact: false })
            .click();
          await page
            .getByRole("button", { name: "直近7回の記録", exact: true })
            .click();
          await expect(page.locator(".recent-dialog li")).toHaveCount(1);
          await expect(page.locator(".recent-dialog")).toContainText(
            "一時記録",
          );
          lines.push(
            `${name}: storage unavailable; memory-only attempt visible with warning. PASS`,
          );
        } finally {
          await memory.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
  if (!publicCheck) assert.equal(await artifactDigest("dist-playtest"), before);
  await writeFile(
    `evidence/history-${publicCheck ? "public" : "local"}.txt`,
    lines.join("\n") + `\nChecked digest: ${before ?? "public HTTPS"}\n`,
  );
} finally {
  child?.kill("SIGTERM");
}
