import { chromium, firefox, webkit } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { artifactDigest } from "./artifact.mjs";
import {
  fixedPath,
  publicOrigin,
  publicMetadata,
} from "../packages/game-core/public-route.ts";

let origin = process.argv[2],
  child;
const isPublic = Boolean(origin?.startsWith("https:"));
const buildBefore = isPublic ? null : await artifactDigest("dist-playtest");
if (!origin) {
  child = spawn(process.execPath, [resolve("scripts/static-server.mjs")], {
    env: {
      ...process.env,
      ONEBOX_SERVE_ROOT: resolve("dist-playtest"),
      ONEBOX_PORT: "0",
      PUBLIC_ORIGIN: publicOrigin,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [output] = await once(child.stdout, "data");
  origin = `http://127.0.0.1:${String(output).match(/:(\d+)/)[1]}`;
}
const solution = JSON.parse(
  await readFile("examples/sample_solution.PRIVATE.json", "utf8"),
).placements;
const engines = isPublic ? { chromium } : { chromium, firefox, webkit },
  lines = [],
  hashes = new Set();
try {
  for (const [name, engine] of Object.entries(engines)) {
    const browser = await engine.launch();
    try {
      for (const locale of ["ja", "en"]) {
        const ja = locale === "ja",
          context = await browser.newContext({
            acceptDownloads: true,
            viewport: { width: 390, height: 844 },
            hasTouch: true,
            timezoneId: ja ? "Asia/Tokyo" : "America/Los_Angeles",
          });
        try {
          const page = await context.newPage(),
            errors = [],
            responses = [];
          page.on("pageerror", (e) => errors.push(e.message));
          page.on("response", (r) => responses.push(r.url()));
          // Synthetic capability/failure checks never invoke an OS share or overwrite its clipboard.
          await page.addInitScript(() => {
            window.shareOutcome = "abort";
            window.shareSupported = true;
            Object.defineProperty(navigator, "canShare", {
              configurable: true,
              value: (data) => {
                window.checkedShareData = data;
                return window.shareSupported;
              },
            });
            Object.defineProperty(navigator, "share", {
              configurable: true,
              value: async (data) => {
                window.sharedData = data;
                if (window.shareOutcome === "abort")
                  throw new DOMException("Closed", "AbortError");
                if (window.shareOutcome === "failure")
                  throw new DOMException("Denied", "NotAllowedError");
              },
            });
            Object.defineProperty(navigator, "clipboard", {
              configurable: true,
              value: {
                writeText: async (text) => {
                  if (!window.copyAllowed)
                    throw new DOMException("Denied", "NotAllowedError");
                  window.copiedText = text;
                },
              },
            });
            window.canvasText = [];
            const draw = CanvasRenderingContext2D.prototype.fillText;
            CanvasRenderingContext2D.prototype.fillText = function (...args) {
              window.canvasText.push(args[0]);
              return draw.apply(this, args);
            };
          });
          const path = fixedPath(locale) + "?src=share",
            response = await page.goto(origin + path);
          assert.equal(response.status(), 200);
          const html = await response.text(),
            meta = publicMetadata(locale);
          assert.ok(html.includes(`<html lang="${locale}">`));
          assert.ok(html.includes(meta.description));
          assert.ok(
            html.includes(
              `<link rel="canonical" href="${publicOrigin + fixedPath(locale)}"`,
            ),
          );
          assert.ok(html.includes(`hreflang="${ja ? "en" : "ja"}"`));
          const coverPath = new URL(
            html.match(/property="og:image" content="([^"]+)"/)[1],
          ).pathname;
          const cover = await fetch(origin + coverPath);
          assert.equal(cover.status, 200);
          assert.match(cover.headers.get("content-type"), /image\/png/);
          const coverBytes = Buffer.from(await cover.arrayBuffer());
          assert.equal(coverBytes.readUInt32BE(16), 1200);
          assert.equal(coverBytes.readUInt32BE(20), 630);
          await page
            .getByRole("button", {
              name: ja ? "箱を開く" : "Open the box",
              exact: false,
            })
            .tap();
          for (const q of solution) {
            await page.locator(`[data-piece="${q.piece_id}"]`).tap();
            for (let i = 0; i < q.rotation; i++)
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
          await page
            .getByRole("heading", {
              name: ja ? "ぴったり！" : "A perfect fit!",
              exact: true,
            })
            .waitFor();
          const records = await page.evaluate(() =>
            Object.keys(localStorage)
              .filter((k) => k.startsWith("onebox:v1:run:"))
              .map((k) => JSON.parse(localStorage[k])),
          );
          assert.equal(records.length, 1);
          assert.equal(records[0].mode, "practice");
          hashes.add(records[0].puzzle_hash);
          const shareButton = page.getByRole("button", {
            name: ja ? "この問題を友達に送る" : "Send this puzzle to a friend",
            exact: true,
          });
          await shareButton.click();
          const dialog = page.locator(".share-dialog"),
            preview = dialog.locator("textarea"),
            status = dialog.getByRole("status");
          const text = await preview.inputValue();
          assert.ok(text.endsWith(publicOrigin + path));
          assert.ok(!text.includes(records[0].run_id));
          assert.doesNotMatch(text, /placements|rotation|puzzle_hash|run_id/);
          await dialog
            .getByRole("button", {
              name: ja ? "共有先を選ぶ" : "Choose a share destination",
            })
            .click();
          await status
            .getByText(ja ? "共有を閉じました。" : "Share sheet closed.", {
              exact: true,
            })
            .waitFor();
          await page.evaluate(() => {
            window.shareOutcome = "success";
          });
          await dialog
            .getByRole("button", {
              name: ja ? "共有先を選ぶ" : "Choose a share destination",
            })
            .click();
          await status
            .getByText(
              ja
                ? "共有先に渡しました。投稿完了は共有先で確認してください。"
                : "Passed to the share destination. Check there to confirm posting.",
              { exact: true },
            )
            .waitFor();
          const data = await page.evaluate(() => window.sharedData);
          assert.equal(data.url, publicOrigin + path);
          assert.deepEqual(Object.keys(data).sort(), ["text", "title", "url"]);
          await page.evaluate(() => {
            window.shareOutcome = "failure";
          });
          await dialog
            .getByRole("button", {
              name: ja ? "共有先を選ぶ" : "Choose a share destination",
            })
            .click();
          await status
            .getByText(
              ja
                ? "共有先を開けませんでした。コピーまたはテキストの選択を使えます。"
                : "Could not open sharing. Copy or select the text instead.",
              { exact: true },
            )
            .waitFor();
          const copy = dialog.getByRole("button", {
            name: ja ? "共有文とリンクをコピー" : "Copy text and link",
            exact: true,
          });
          await copy.click();
          await status
            .getByText(
              ja
                ? "コピーできませんでした。選択したテキストを手動でコピーしてください。"
                : "Could not copy. Manually copy the selected text.",
              { exact: true },
            )
            .waitFor();
          assert.equal(
            await preview.evaluate((e) => e.selectionEnd - e.selectionStart),
            text.length,
          );
          await page.evaluate(() => {
            window.copyAllowed = true;
          });
          await copy.click();
          await status
            .getByText(
              ja ? "共有文とリンクをコピーしました。" : "Text and link copied.",
              { exact: true },
            )
            .waitFor();
          assert.equal(await page.evaluate(() => window.copiedText), text);
          const close = dialog.getByRole("button", {
            name: ja ? "閉じる" : "Close",
            exact: true,
          });
          await close.click();
          await page.evaluate(() => {
            window.shareSupported = false;
          });
          await page
            .getByRole("button", {
              name: ja ? "設定・遊び方" : "Settings & how to play",
              exact: true,
            })
            .click();
          await page
            .getByRole("checkbox", {
              name: ja ? "時間を表示" : "Show time",
              exact: true,
            })
            .uncheck();
          await page
            .getByRole("button", { name: ja ? "閉じる" : "Close", exact: true })
            .click();
          await shareButton.click();
          assert.equal(
            await dialog
              .getByRole("button", {
                name: ja ? "共有先を選ぶ" : "Choose a share destination",
              })
              .count(),
            0,
          );
          const hiddenTimeText = await preview.inputValue();
          assert.doesNotMatch(hiddenTimeText, /\d+(?:\.\d+)?秒|seconds/);
          const pending = page.waitForEvent("download");
          await dialog
            .getByRole("button", {
              name: ja ? "結果画像を保存" : "Save result image",
              exact: true,
            })
            .click();
          const download = await pending,
            stream = await download.createReadStream(),
            chunks = [];
          for await (const chunk of stream) chunks.push(Buffer.from(chunk));
          const png = Buffer.concat(chunks);
          assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
          assert.equal(png.readUInt32BE(16), 1200);
          assert.equal(png.readUInt32BE(20), 800);
          assert.doesNotMatch(
            (await page.evaluate(() => window.canvasText)).join("\n"),
            /\d+(?:\.\d+)?秒|seconds|placements|run_id/,
          );
          if (name === "chromium" && ja && !isPublic)
            await writeFile("evidence/share-result-no-time.png", png);
          await page.evaluate(() => {
            HTMLCanvasElement.prototype.getContext = () => null;
          });
          await dialog
            .getByRole("button", {
              name: ja ? "結果画像を保存" : "Save result image",
              exact: true,
            })
            .click();
          await status
            .getByText(
              ja
                ? "画像を作成できませんでした。共有文とリンクを使えます。"
                : "Could not create the image. Use text and link instead.",
              { exact: true },
            )
            .waitFor();
          for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            assert.ok(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            );
          }
          if (name === "chromium" && ja)
            await page.screenshot({
              path: `evidence/sharing-${isPublic ? "public" : "local"}.png`,
              fullPage: true,
            });
          await close.click();
          await page
            .getByRole("button", { name: "Language", exact: true })
            .click();
          const other = ja ? "en" : "ja";
          assert.equal(new URL(page.url()).pathname, fixedPath(other));
          assert.equal(new URL(page.url()).search, "?src=share");
          assert.equal(
            await page.locator('link[rel="canonical"]').getAttribute("href"),
            publicOrigin + fixedPath(other),
          );
          // Move only wall time after completion. A friend's original fixed link stays the same.
          await page.clock.setFixedTime(new Date("2026-10-15T00:01:00Z"));
          await page.reload();
          await page
            .getByRole("heading", {
              name: other === "ja" ? "ぴったり！" : "A perfect fit!",
              exact: true,
            })
            .waitFor();
          assert.equal(
            await page.evaluate(
              () =>
                Object.keys(localStorage)
                  .filter((k) => k.startsWith("onebox:v1:run:"))
                  .map((k) => JSON.parse(localStorage[k]))[0].puzzle_hash,
            ),
            records[0].puzzle_hash,
          );
          assert.deepEqual(errors, []);
          if (isPublic) {
            assert.deepEqual(await context.cookies(), []);
            assert.equal(
              await page.evaluate(() => typeof window.gtag),
              "undefined",
            );
          }
          assert.ok(
            responses.every((url) => {
              const u = new URL(url);
              return (
                u.origin === origin &&
                (u.pathname === fixedPath(locale) ||
                  u.pathname === fixedPath(other) ||
                  u.pathname === "/release.json" ||
                  (u.pathname.startsWith("/puzzles/") &&
                    hashes.has(u.pathname.slice(9, -5))) ||
                  u.pathname.startsWith("/assets/"))
              );
            }),
          );
          lines.push(
            `${name} ${locale}: static locale/canonical/OG, shared fixed URL and completion, mock share cancel/handoff/failure, clipboard fallback/success, hidden-time PNG and image fallback, 4 widths, language/next-day hash stability PASS`,
          );
          console.log(`${name} ${locale}: fixed route and sharing checks PASS`);
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
  assert.equal(hashes.size, 1);
  for (const path of [
    "/ja/p/not-published/",
    "/ja/p/candidate-35bad118a3d8/",
    "/ja/p/playtest-fixed-v1/?src=share&run_id=private",
    "/api/candidates",
    "/api/inventory",
  ]) {
    assert.equal((await fetch(origin + path)).status, 404);
    lines.push(`${path}: 404`);
  }
  if (!isPublic)
    assert.equal(await artifactDigest("dist-playtest"), buildBefore);
  lines.push(
    `Same payload hash across locale/timezone/engines: ${[...hashes][0]}`,
  );
  lines.push(
    "All share/clipboard API outcomes above are mocks. No human/device/OS posting evidence is claimed.",
  );
  await writeFile(
    `evidence/sharing-${isPublic ? "public" : "local"}.txt`,
    lines.join("\n") + "\n",
  );
  console.log(lines.join("\n"));
  if (buildBefore)
    console.log(`Checked immutable build digest: ${buildBefore}`);
} finally {
  if (child) {
    const stopped = once(child, "exit");
    child.kill("SIGTERM");
    await stopped;
  }
}
