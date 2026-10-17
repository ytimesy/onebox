import { chromium, firefox, webkit, expect } from "@playwright/test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  readFile,
  writeFile,
  mkdir,
  cp,
  rm,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DailyRehearsal } from "../packages/puzzle-tools/daily-rehearsal.ts";
import { prepareDaily } from "../packages/puzzle-tools/daily.ts";
import { syntheticQualityCatalog } from "../tests/helpers/quality-catalog.ts";
import { solve } from "../packages/game-core/solver.ts";
const base = resolve("evidence/daily-preview");
assert.equal(
  await readFile(join(base, ".LOCAL_SIMULATION"), "utf8"),
  "ONEBOX synthetic daily preview v1\n",
);
const evidence = resolve(
  process.env.ONEBOX_COMMIT_EVIDENCE ?? "evidence/daily-commit-check",
);
await mkdir(evidence, { recursive: true });
const temp = await realpath(
  await mkdtemp(join(tmpdir(), "onebox-atomic-browser-")),
);
const at = new Date().toISOString(),
  catalog = syntheticQualityCatalog(at),
  day = at.slice(0, 10);
const plan = prepareDaily(
  catalog,
  catalog.entries[0].puzzle.puzzle_id,
  day,
  at,
);
const store = await DailyRehearsal.initialize(
    join(temp, "transactions"),
    catalog,
  ),
  before = await store.read();
const lines = [];
try {
  let checks = 0;
  const result = await store.commit(plan, at, before.hash, async (pub) => {
    const root = join(temp, "candidate");
    await mkdir(root);
    await cp(pub, root, { recursive: true });
    await cp(join(base, "assets"), join(root, "assets"), { recursive: true });
    await writeFile(
      join(root, ".LOCAL_SIMULATION"),
      "ONEBOX synthetic daily preview v1\n",
    );
    for (const locale of ["ja", "en"]) {
      const html = await readFile(join(base, locale, "index.html"), "utf8");
      for (const path of [
        `/${locale}/`,
        `/${locale}/p/${plan.manifest.active.slug}/`,
      ]) {
        await mkdir(root + path, { recursive: true });
        await writeFile(root + path + "index.html", html);
      }
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
    const [output] = await once(child.stdout, "data"),
      origin = String(output).match(/http:\/\/127\.0\.0\.1:\d+/)[0];
    try {
      for (const [name, engine] of Object.entries({
        chromium,
        firefox,
        webkit,
      })) {
        const browser = await engine.launch();
        try {
          for (const locale of ["ja", "en"]) {
            const context = await browser.newContext({
                hasTouch: true,
                viewport: { width: 390, height: 844 },
              }),
              page = await context.newPage(),
              errors = [];
            page.on("pageerror", (e) => errors.push(e.message));
            try {
              const ja = locale === "ja";
              assert.equal(
                (
                  await page.goto(
                    origin + `/${locale}/p/${plan.manifest.active.slug}/`,
                  )
                ).status(),
                200,
              );
              await page
                .getByRole("button", {
                  name: ja ? "箱を開く" : "Open the box",
                  exact: false,
                })
                .tap();
              const puzzle = JSON.parse(plan.payload_json);
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
              const saved = await page.evaluate(
                (id) =>
                  JSON.parse(localStorage.getItem(`onebox:v1:current:${id}`)),
                puzzle.puzzle_id,
              );
              assert.equal(saved.puzzle_hash, plan.manifest.active.sha256);
              assert.equal(saved.state, "completed");
              await page
                .getByRole("button", {
                  name: ja ? "直近7回の記録" : "Last 7 attempts",
                  exact: true,
                })
                .click();
              await expect(page.locator(".recent-dialog li")).toHaveCount(1);
              await expect(
                page.locator(".recent-dialog").getByRole("link", { name: day }),
              ).toHaveAttribute(
                "href",
                `/${locale}/p/${plan.manifest.active.slug}/`,
              );
              assert.deepEqual(errors, []);
              if (name === "chromium" && ja)
                await page.screenshot({
                  path: join(evidence, "staged-result-390.png"),
                });
              lines.push(
                `${name} ${locale}: staged private commit payload/hash, fixed URL, touch completion/save/history PASS`,
              );
              checks++;
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
        "/.LOCAL_DAILY",
        "/.LOCAL_SIMULATION",
      ])
        assert.equal((await fetch(origin + path)).status, 404);
      assert.equal(
        (await store.read()).hash,
        before.hash,
        "No activation before browser checks finish",
      );
    } finally {
      const stopped = once(child, "exit");
      child.kill("SIGTERM");
      await stopped;
    }
  });
  assert.equal(checks, 6);
  assert.equal((await store.read()).hash, result.hash);
  assert.equal(result.state.catalog.history.total_released, 1);
  const replay = await store.commit(plan, at, before.hash, async () => {
    throw Error("Idempotent replay must not rerun activation");
  });
  assert.equal(replay.unchanged, true);
  assert.equal(replay.hash, result.hash);
  lines.push(
    "Browser verification preceded atomic current switch; copied catalog/history and manifest agree; replay keeps one publication. LOCAL synthetic rehearsal only; no main catalog/production/job changes.",
  );
  await writeFile(join(evidence, "browser-check.log"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
} finally {
  await rm(temp, { recursive: true, force: true });
}
