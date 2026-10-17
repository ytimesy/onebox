import { chromium, firefox, webkit } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  validateManifest,
  validatePublishedPuzzle,
  validatePublishedArchive,
} from "../packages/game-core/release.ts";
import { verify } from "../packages/puzzle-tools/generator.ts";

export async function checkProductionBrowser(root, options = {}) {
  let child,
    origin = options.origin;
  if (!origin) {
    child = spawn(process.execPath, [resolve("scripts/static-server.mjs")], {
      env: { ...process.env, ONEBOX_SERVE_ROOT: root, ONEBOX_PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [out] = await once(child.stdout, "data");
    origin = "http://127.0.0.1:" + String(out).match(/:(\d+)/)[1];
  }
  const lines = [];
  try {
    const manifest = validateManifest(
      await (await fetch(origin + "/release.json")).json(),
    );
    assert.equal(manifest.stage, "daily");
    const archive = await validatePublishedArchive(
      await (await fetch(origin + manifest.archive.url)).json(),
      manifest,
    );
    const practice = validateManifest(
      await (await fetch(origin + "/practice-release.json")).json(),
    );
    const entries = [manifest.active, practice.active];
    if (archive.entries.length > 1)
      entries.push(
        archive.entries.find(
          (e) =>
            e.puzzle_id !== manifest.active.puzzle_id &&
            !manifest.recalled_ids.includes(e.puzzle_id),
        ),
      );
    const engines = options.allEngines
      ? { chromium, firefox, webkit }
      : { chromium };
    for (const [name, engine] of Object.entries(engines)) {
      const browser = await engine.launch();
      try {
        for (const locale of ["ja", "en"]) {
          for (const entry of entries.filter(Boolean)) {
            const context = await browser.newContext({
              viewport: { width: 390, height: 844 },
              hasTouch: true,
            });
            try {
              const page = await context.newPage(),
                errors = [];
              page.on("pageerror", (e) => errors.push(e.message));
              const puzzle = await validatePublishedPuzzle(
                  await (await fetch(origin + entry.payload_url)).json(),
                  entry,
                ),
                solution = verify(puzzle).solution;
              assert(solution);
              const path = `/${locale}/p/${entry.slug}/`,
                r = await page.goto(origin + path);
              assert.equal(r.status(), 200);
              await page
                .getByRole("button", {
                  name: locale === "ja" ? /箱を開く/ : /Open the box/,
                })
                .click();
              await page.locator(".board").waitFor();
              await context.setOffline(true);
              for (const q of solution) {
                await page.locator(`[data-piece="${q.piece_id}"]`).tap();
                const initial = puzzle.pieces.find(
                  (p) => p.id === q.piece_id,
                ).initial_rotation;
                for (let i = 0; i < (q.rotation - initial + 4) % 4; i++)
                  await page
                    .getByRole("button", {
                      name: locale === "ja" ? /回転/ : /Rotate/,
                    })
                    .click();
                await page.locator(`[data-cell="${q.x},${q.y}"]`).tap();
                await page
                  .getByRole("button", {
                    name: locale === "ja" ? /置く/ : /Place/,
                  })
                  .click();
              }
              await page
                .getByRole("heading", {
                  name: locale === "ja" ? "ぴったり！" : "A perfect fit!",
                  exact: true,
                })
                .waitFor();
              await page
                .getByRole("button", {
                  name: locale === "ja" ? "Xに投稿" : "Post to X",
                  exact: true,
                })
                .click();
              const dialog = page.getByRole("dialog");
              await dialog.waitFor();
              const link = dialog.getByRole("link", {
                name: locale === "ja" ? /X/ : /X/,
              });
              const href = await link.getAttribute("href");
              const intent = new URL(href);
              assert.equal(intent.origin, "https://x.com");
              assert.equal(
                new URL(intent.searchParams.get("url")).pathname,
                path,
              );
              await dialog
                .getByRole("button", {
                  name: locale === "ja" ? "閉じる" : "Close",
                  exact: true,
                })
                .click();
              await context.setOffline(false);
              await page.reload();
              await page
                .getByRole("heading", {
                  name: locale === "ja" ? "ぴったり！" : "A perfect fit!",
                  exact: true,
                })
                .waitFor();
              for (const width of [320, 390, 768, 1440]) {
                await page.setViewportSize({ width, height: 900 });
                assert(
                  await page.evaluate(
                    () =>
                      document.documentElement.scrollWidth <= innerWidth + 1,
                  ),
                );
              }
              assert.deepEqual(errors, []);
              lines.push(
                `${name} ${locale} ${entry.slug}: hash/start/complete/save/share/4 widths PASS`,
              );
              if (options.evidence) {
                await mkdir(options.evidence, { recursive: true });
                await page.screenshot({
                  path: resolve(
                    options.evidence,
                    `${name}-${locale}-${entry.slug}.png`,
                  ),
                });
              }
            } finally {
              await context.close();
            }
          }
          const c = await browser.newContext();
          try {
            const p = await c.newPage();
            assert.equal((await p.goto(origin + `/${locale}/`)).status(), 200);
            await p
              .getByRole("button", {
                name: locale === "ja" ? /箱を開く/ : /Open the box/,
              })
              .waitFor();
            assert(
              (await p.locator("body").textContent()).includes(
                locale === "ja" ? "日替わりパズル" : "Daily puzzle",
              ),
              `${locale}: ${await p.locator("body").innerText()}`,
            );
            await p.route("**/release.json", (route) =>
              route.fulfill({
                status: 200,
                contentType: "application/json",
                body: "{",
              }),
            );
            await p.reload();
            await p
              .getByRole("status")
              .filter({
                hasText:
                  locale === "ja"
                    ? "問題を読み込めませんでした"
                    : "Could not load the puzzle",
              })
              .waitFor();
            assert.equal(
              await p
                .getByRole("button", {
                  name: locale === "ja" ? /箱を開く/ : /Open the box/,
                })
                .count(),
              0,
            );
            await p.unroute("**/release.json");
            await p
              .getByRole("button", {
                name: locale === "ja" ? "もう一度読み込む" : "Try again",
                exact: true,
              })
              .click();
            await p
              .getByRole("button", {
                name: locale === "ja" ? /箱を開く/ : /Open the box/,
              })
              .waitFor();
            assert(
              !(await p.locator("body").innerText()).includes(
                locale === "ja"
                  ? "一般公開ではありません"
                  : "not a public release",
              ),
            );
          } finally {
            await c.close();
          }
        }
      } finally {
        await browser.close();
      }
    }
    for (const path of [
      "/api/candidates",
      "/state.PRIVATE.json",
      "/.LOCAL_SIMULATION",
      "/packages/puzzle-tools/production.ts",
      "/puzzles/" + "a".repeat(64) + ".json",
      "/ja/p/onebox-2099-01-01/",
      "/archives/" + "b".repeat(64) + ".json",
    ])
      assert.equal((await fetch(origin + path)).status, 404, path);
    lines.push("public/private/unknown/future boundaries PASS");
    if (options.evidence)
      await writeFile(
        resolve(options.evidence, "browser.log"),
        lines.join("\n") + "\n",
      );
    return lines;
  } finally {
    if (child) {
      const stopped = once(child, "exit");
      child.kill("SIGTERM");
      await stopped;
    }
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const lines = await checkProductionBrowser(
    resolve(process.argv[2] ?? "var/current"),
    {
      origin: process.argv[3],
      allEngines: process.env.ONEBOX_ALL_ENGINES === "1",
      evidence: process.env.ONEBOX_PRODUCTION_EVIDENCE,
    },
  );
  console.log(lines.join("\n"));
}
