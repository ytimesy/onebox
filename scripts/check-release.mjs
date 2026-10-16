import { chromium, firefox, webkit, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, cp, rm, unlink } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  validateManifest,
  validatePublishedPuzzle,
} from "../packages/game-core/release.ts";
import { artifactDigest } from "./artifact.mjs";
let origin = process.argv[2],
  child;
const publicCheck = Boolean(origin),
  before = await artifactDigest("dist-playtest"),
  lines = [];
if (!origin) {
  child = spawn(process.execPath, [resolve("scripts/static-server.mjs")], {
    env: {
      ...process.env,
      ONEBOX_SERVE_ROOT: resolve("dist-playtest"),
      ONEBOX_PORT: "0",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [output] = await once(child.stdout, "data");
  origin = `http://127.0.0.1:${String(output).match(/:(\d+)/)[1]}`;
}
try {
  const response = await fetch(origin + "/release.json"),
    manifest = validateManifest(await response.json());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-cache/);
  const payloadResponse = await fetch(origin + manifest.active.payload_url),
    payload = await payloadResponse.json();
  await validatePublishedPuzzle(payload, manifest.active);
  assert.match(payloadResponse.headers.get("cache-control"), /immutable/);
  assert.equal(manifest.next_update_at, null);
  for (const [name, engine] of Object.entries(
    publicCheck ? { chromium } : { chromium, firefox, webkit },
  )) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext(),
        page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      for (const bad of ["malformed", "hash", "rules", "private"]) {
        if (bad === "malformed")
          await page.route("**/release.json", (route) =>
            route.fulfill({
              status: 200,
              contentType: "application/json",
              body: "{",
            }),
          );
        else
          await page.route("**" + manifest.active.payload_url, (route) =>
            route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify(
                bad === "hash"
                  ? { ...payload, pieces: [...payload.pieces].reverse() }
                  : bad === "rules"
                    ? { ...payload, rules_version: "unknown" }
                    : { ...payload, purpose: "design_verification_only" },
              ),
            }),
          );
        await page.goto(origin + "/ja/");
        await expect(
          page.getByText("問題を読み込めませんでした", { exact: false }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "箱を開く", exact: false }),
        ).toHaveCount(0);
        await page.unrouteAll();
        await page
          .getByRole("button", { name: "もう一度読み込む", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "箱を開く", exact: false }),
        ).toBeVisible();
      }
      await page.route("**/release.json", (route) => route.abort());
      await page.goto(origin + "/en/");
      await expect(
        page.getByText("Could not load the puzzle", { exact: false }),
      ).toBeVisible();
      await page.unrouteAll();
      await page
        .getByRole("button", { name: "Try again", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Open the box", exact: false }),
      ).toBeVisible();
      assert.deepEqual(errors, []);
      lines.push(
        `${name}: malformed manifest/hash mismatch/unknown rules/private purpose/network failure block start; explicit retry recovers. PASS`,
      );
      await context.close();
    } finally {
      await browser.close();
    }
  }
  if (!publicCheck) {
    for (const bad of ["missing", "extra"]) {
      const temp = await mkdtemp(resolve(tmpdir(), "onebox-release-"));
      try {
        await cp("dist-playtest", temp, { recursive: true });
        if (bad === "missing") await unlink(temp + manifest.active.payload_url);
        else
          await writeFile(
            temp + "/puzzles/" + "f".repeat(64) + ".json",
            '{"future":"must-not-publish"}',
          );
        const result = spawnSync(
          process.execPath,
          ["scripts/check-dist.mjs", temp],
          { encoding: "utf8" },
        );
        assert.notEqual(result.status, 0);
        lines.push(
          `build gate rejects ${bad} referenced/unlisted payload. PASS`,
        );
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    }
  }
  assert.equal(await artifactDigest("dist-playtest"), before);
  await writeFile(
    `evidence/release-${publicCheck ? "public" : "local"}.txt`,
    lines.join("\n") +
      `\nPayload hash ${manifest.active.sha256}; stage playtest; next update unscheduled.\nChecked digest: ${before}\n`,
  );
  console.log(lines.join("\n"));
} finally {
  child?.kill("SIGTERM");
}
