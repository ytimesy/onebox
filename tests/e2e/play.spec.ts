import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  occupied,
  rotate,
  type Placement,
  validatePuzzle,
} from "../../packages/game-core";
const puzzle = validatePuzzle(
  JSON.parse(readFileSync("examples/sample_puzzle.json", "utf8")),
);
const solution = JSON.parse(
  readFileSync("examples/sample_solution.PRIVATE.json", "utf8"),
).placements as Placement[];
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? [], "Unhandled browser errors").toEqual([]);
});
async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "箱を開く" }).click();
  await expect(page.locator(".board")).toBeVisible();
}
async function tapPlace(page: Page, q: Placement) {
  await page.locator(`[data-piece="${q.piece_id}"]`).click();
  for (let i = 0; i < q.rotation; i++)
    await page.getByRole("button", { name: "回転", exact: false }).click();
  await page.locator(`[data-cell="${q.x},${q.y}"]`).click();
  await page.getByRole("button", { name: "置く", exact: false }).click();
  // Ownership transactions settle after the optimistic board commit.
  if (
    !(await page
      .locator(".notice")
      .filter({ hasText: "記録を保存・復元" })
      .count())
  )
    await expect
      .poll(() =>
        page.evaluate(
          ({ id, q }) => {
            const current = JSON.parse(
              localStorage.getItem(`onebox:v1:current:${id}`) ?? "null",
            );
            return (
              current?.placements.some(
                (v: Placement) =>
                  v.piece_id === q.piece_id &&
                  v.rotation === q.rotation &&
                  v.x === q.x &&
                  v.y === q.y,
              ) ?? false
            );
          },
          { id: puzzle.puzzle_id, q },
        ),
      )
      .toBe(true);
}
async function keyPlace(page: Page, q: Placement) {
  await page.locator(`[data-piece="${q.piece_id}"]`).focus();
  await page.keyboard.press("Space");
  await page.locator(".board").focus();
  for (let i = 0; i < q.rotation; i++) await page.keyboard.press("r");
  for (let i = 0; i < q.x; i++) await page.keyboard.press("ArrowRight");
  for (let i = 0; i < q.y; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
}
async function records(page: Page) {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith("onebox:v1:run:"))
      .map((k) => JSON.parse(localStorage.getItem(k)!)),
  );
}
test("tap-only completion, first result remains after practice and reload", async ({
  page,
}) => {
  await start(page);
  for (const q of solution) await tapPlace(page, q);
  await expect(page.getByRole("heading", { name: "ぴったり！" })).toBeVisible();
  const first = (await records(page)).find((a) => a.mode === "first");
  expect(first.state).toBe("completed");
  await page.getByRole("button", { name: "もう一度練習" }).click();
  await expect(page.locator(".puzzle-id")).toContainText("練習");
  await page.reload();
  await expect(page.getByRole("button", { name: "続きを遊ぶ" })).toBeVisible();
  const now = (await records(page)).find((a) => a.run_id === first.run_id);
  expect(now).toEqual(first);
});
test("keyboard-only completion", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "箱を開く" }).focus();
  await page.keyboard.press("Enter");
  for (const q of solution) await keyPlace(page, q);
  await expect(page.getByRole("heading", { name: "ぴったり！" })).toBeVisible();
});
test("drag-only completion preserves the grabbed cell", async ({ page }) => {
  await start(page);
  const d = page.locator('[data-piece="D"]');
  await d.click();
  await page.getByRole("button", { name: "回転", exact: false }).click();
  await page.getByRole("button", { name: "回転", exact: false }).click(); // equivalent orientation 2
  // reset preview orientation to 0
  await page.getByRole("button", { name: "回転", exact: false }).click();
  await page.getByRole("button", { name: "回転", exact: false }).click();
  for (const q of solution) {
    await page.locator(`[data-piece="${q.piece_id}"]`).click();
    for (let i = 0; i < q.rotation; i++)
      await page.getByRole("button", { name: "回転", exact: false }).click();
    const cells = rotate(
        puzzle.pieces.find((p) => p.id === q.piece_id)!.cells,
        q.rotation,
      ),
      grab = cells[0];
    const svg = page.locator(`[data-piece="${q.piece_id}"] svg`);
    const point = await svg.evaluate((s, args) => {
      const svg = s as SVGSVGElement,
        pt = svg.createSVGPoint();
      pt.x = args[0] * 22 + 11;
      pt.y = args[1] * 22 + 11;
      const p = pt.matrixTransform(svg.getScreenCTM()!);
      return { x: p.x, y: p.y };
    }, grab);
    const cell = await page
      .locator(`[data-cell="${q.x + grab[0]},${q.y + grab[1]}"]`)
      .boundingBox();
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(
      cell!.x + cell!.width / 2,
      cell!.y + cell!.height / 2,
      { steps: 10 },
    );
    await page.mouse.up();
  }
  await expect(page.getByRole("heading", { name: "ぴったり！" })).toBeVisible();
});
test("invalid placement, undo and hint counts cannot be undone", async ({
  page,
}) => {
  await start(page);
  await page.locator('[data-piece="D"]').click();
  await page.locator('[data-cell="0,0"]').click();
  await page.getByRole("button", { name: "置く", exact: false }).click();
  await expect(page.getByRole("status").first()).toContainText("斜線");
  await expect
    .poll(async () => (await records(page))[0].placements.length)
    .toBe(0);
  await page.getByRole("button", { name: "選択を解除" }).click();
  await tapPlace(page, solution[0]);
  await page.getByRole("button", { name: "取消", exact: false }).click();
  await expect
    .poll(async () => (await records(page))[0].placements.length)
    .toBe(0);
  await page.getByRole("button", { name: "ヒント", exact: false }).click();
  await expect(page.getByRole("status").first()).toContainText("置き場所");
  await expect.poll(async () => (await records(page))[0].hint_count).toBe(1);
  await tapPlace(page, solution[0]);
  await page.getByRole("button", { name: "取消", exact: false }).click();
  await expect.poll(async () => (await records(page))[0].hint_count).toBe(1);
});
test("reload pauses, hides board, and resumes with interruption; locale preserves puzzle", async ({
  page,
}) => {
  await start(page);
  await tapPlace(page, solution[0]);
  await page.reload();
  await expect(page.locator(".board")).toHaveCount(0);
  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  await expect(page.locator(".board")).toBeVisible();
  await expect(page.locator(".puzzle-id")).toContainText("fixture-011");
  const a = (await records(page))[0];
  expect(a.interrupted).toBe(true);
  expect(a.clock_status).toBe("resumed");
  expect(a.placements).toHaveLength(1);
});
test("storage denied still allows completion", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException("denied", "QuotaExceededError");
    };
  });
  await start(page);
  for (const q of solution) await tapPlace(page, q);
  await expect(page.getByRole("heading", { name: "ぴったり！" })).toBeVisible();
  await expect(page.locator(".notice")).toContainText("そのまま遊べます");
});
test("corrupt save recovers; clear removes only ONEBOX keys", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("other-service", "keep");
    localStorage.setItem("onebox:v1:current:fixture-011", "{broken");
  });
  await start(page);
  await page.getByRole("button", { name: "設定・遊び方", exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "このアプリの記録を消す" }).click();
  expect(await page.evaluate(() => localStorage.getItem("other-service"))).toBe(
    "keep",
  );
});
test("second tab cannot overwrite or start a parallel first run", async ({
  page,
  context,
}) => {
  await start(page);
  await tapPlace(page, solution[0]);
  const first = (await records(page))[0];
  const second = await context.newPage();
  await second.goto("/");
  await second
    .getByRole("button", { name: "続きを遊ぶ →", exact: true })
    .click();
  await expect(second.getByRole("alert")).toContainText("別のタブ");
  expect((await records(page))[0].run_id).toBe(first.run_id);
  await page.close();
  await second
    .getByRole("alert")
    .getByRole("button", { name: "このタブで続ける" })
    .click();
  await expect(second.locator(".board")).toBeVisible();
  expect((await records(second))[0].placements).toHaveLength(1);
});
test("clearing records in another tab stops the active game and never resurrects a saved run", async ({
  page,
  context,
}) => {
  await start(page);
  await tapPlace(page, solution[0]);
  const second = await context.newPage();
  await second.goto("/");
  await second
    .getByRole("button", { name: "設定・遊び方", exact: true })
    .click();
  second.once("dialog", (d) => d.accept());
  await second.getByRole("button", { name: "このアプリの記録を消す" }).click();
  await expect(
    page.getByRole("button", { name: "箱を開く", exact: false }),
  ).toBeVisible();
  await page.clock.install();
  await page.clock.fastForward(3000);
  expect(await records(page)).toHaveLength(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "箱を開く", exact: false }),
  ).toBeVisible();
});
test("clearing records also cancels a start waiting for a browser lock", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    const actualLocks = navigator.locks;
    const target = window as unknown as {
      releasePendingLock: () => void;
      pendingDone: boolean;
    };
    const waiting = new Promise<void>((resolve) => {
      target.releasePendingLock = resolve;
    });
    Object.defineProperty(navigator, "locks", {
      value: {
        request: async (
          _name: string,
          _options: unknown,
          callback: (lock: object) => Promise<void>,
        ) => {
          if (_name === "onebox-storage-v1")
            return actualLocks.request(
              _name,
              _options as LockGrantedCallback<unknown>,
            );
          await waiting;
          await callback({});
          target.pendingDone = true;
        },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "箱を開く", exact: false }).click();
  const second = await context.newPage();
  await second.goto("/");
  await second
    .getByRole("button", { name: "設定・遊び方", exact: true })
    .click();
  second.once("dialog", (d) => d.accept());
  await second.getByRole("button", { name: "このアプリの記録を消す" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("onebox:v1:clear-generation")),
    )
    .not.toBeNull();
  await page.evaluate(() =>
    (
      window as unknown as { releasePendingLock: () => void }
    ).releasePendingLock(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { pendingDone: boolean }).pendingDone,
      ),
    )
    .toBe(true);
  expect(await records(page)).toHaveLength(0);
  await expect(
    page.getByRole("button", { name: "箱を開く", exact: false }),
  ).toBeVisible();
});
test("tutorial uses a different puzzle, reveals final piece through hint", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "操作を試す" }).click();
  await expect(page.locator(".puzzle-id")).toContainText("tutorial-local");
  await expect(page.locator(".cell").filter({ hasText: /[BCD]/ })).toHaveCount(
    15,
  );
  await page.getByRole("button", { name: "ヒント", exact: false }).click();
  await expect(page.getByRole("status").first()).toContainText("A");
});
test("overtime continues and hidden timer remains hidden", async ({ page }) => {
  await start(page);
  await page.clock.install();
  await page.clock.fastForward(61000);
  await expect(page.getByText("もう少し。続けて完成させよう。")).toBeVisible();
  await page.getByRole("button", { name: "設定・遊び方", exact: true }).click();
  await page.getByRole("checkbox", { name: "時間を表示" }).uncheck();
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(page.locator(".clock")).toHaveCount(0);
  for (const q of solution) await tapPlace(page, q);
  await expect(page.getByRole("heading", { name: "ぴったり！" })).toBeVisible();
  await expect(page.locator(".badge")).toHaveCount(0);
});
for (const width of [320, 375, 390, 768, 1280, 1440])
  test(`layout ${width}px without overflow and main controls >=44px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await start(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const btn of await page.locator(".controls button").all()) {
      const b = await btn.boundingBox();
      expect(b!.width).toBeGreaterThanOrEqual(44);
      expect(b!.height).toBeGreaterThanOrEqual(44);
    }
    if (width === 390 || width === 1440)
      await page.screenshot({
        path: `evidence/play-${width}.png`,
        fullPage: true,
      });
  });
test("placed piece survives invalid outside drag and pointercancel", async ({
  page,
}) => {
  await start(page);
  await tapPlace(page, solution[0]);
  const before = (await records(page))[0].placements;
  const cell = await page.locator('[data-cell="0,0"]').boundingBox();
  await page.mouse.move(cell!.x + cell!.width / 2, cell!.y + cell!.height / 2);
  await page.mouse.down();
  await page.mouse.move(8, 8, { steps: 5 });
  await page.mouse.up();
  expect((await records(page))[0].placements).toEqual(before);
  const source = page.locator('[data-cell="0,0"]');
  await page.mouse.move(cell!.x + 10, cell!.y + 10);
  await page.mouse.down();
  await page.mouse.move(cell!.x + 80, cell!.y + 80, { steps: 5 });
  await source.dispatchEvent("pointercancel", {
    pointerId: 1,
    pointerType: "mouse",
  });
  await page.mouse.up();
  expect((await records(page))[0].placements).toEqual(before);
  await expect(page.locator(".drag-ghost")).toHaveCount(0);
});
test("manual pause and solution reveal stay distinct from completion", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: "一時停止", exact: false }).click();
  await expect(page.locator(".board")).toHaveCount(0);
  await page.getByRole("button", { name: "続きを遊ぶ", exact: false }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "解答を見る", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "解答を表示しました" }),
  ).toBeVisible();
  expect((await records(page))[0].state).toBe("revealed");
  await expect(page.locator(".badge")).toHaveCount(0);
});
test("time hidden before start remains hidden during completion", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("checkbox", { name: "時間を表示" }).uncheck();
  await page.getByRole("button", { name: "箱を開く" }).click();
  for (const q of solution) await tapPlace(page, q);
  await expect(page.getByRole("heading", { name: "ぴったり！" })).toBeVisible();
  await expect(page.locator(".clock")).toHaveCount(0);
  expect((await records(page))[0].timer_visible).toBe(false);
});
test("hint worker timeout leaves play and hint count intact", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.Worker = class {
      onmessage = null;
      onerror = null;
      postMessage() {}
      terminate() {}
    } as unknown as typeof Worker;
  });
  await start(page);
  await page.getByRole("button", { name: "ヒント", exact: false }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "準備できませんでした",
    { timeout: 8000 },
  );
  expect((await records(page))[0].hint_count).toBe(0);
  await tapPlace(page, solution[0]);
  expect((await records(page))[0].placements).toHaveLength(1);
});
test("loaded puzzle completes with network disconnected", async ({
  page,
  context,
}) => {
  await start(page);
  await context.setOffline(true);
  for (const q of solution) await tapPlace(page, q);
  await expect(page.getByRole("heading", { name: "ぴったり！" })).toBeVisible();
});
test.describe("touch input", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("touch taps complete the fixed puzzle", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "箱を開く" }).tap();
    for (const q of solution) {
      await page.locator(`[data-piece="${q.piece_id}"]`).tap();
      for (let i = 0; i < q.rotation; i++)
        await page.getByRole("button", { name: "回転", exact: false }).tap();
      await page.locator(`[data-cell="${q.x},${q.y}"]`).tap();
      await page.getByRole("button", { name: "置く", exact: false }).tap();
    }
    await expect(
      page.getByRole("heading", { name: "ぴったり！" }),
    ).toBeVisible();
  });
});
test("clock jumps and UTC boundary cannot replace a running puzzle", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-12T23:59:59Z") });
  await start(page);
  const before = (await records(page))[0];
  await page.clock.setSystemTime(new Date("2026-10-13T09:00:00Z"));
  await tapPlace(page, solution[0]);
  const after = (await records(page))[0];
  expect(after.puzzle_id).toBe(before.puzzle_id);
  expect(after.puzzle_hash).toBe(before.puzzle_hash);
  expect(after.run_id).toBe(before.run_id);
  expect(after.clock_status).toBe("uncertain");
});

test("slow worker download still supplies a hint", async ({ page }) => {
  await page.route("**/assets/hint.worker-*.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue();
  });
  await start(page);
  await page.getByRole("button", { name: "ヒント", exact: false }).click();
  await expect(page.getByRole("status").first()).toContainText("置き場所", {
    timeout: 8000,
  });
  await expect.poll(async () => (await records(page))[0].hint_count).toBe(1);
});
test("worker constructor denied leaves the game playable", async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = class {
      constructor() {
        throw new DOMException("denied", "SecurityError");
      }
    } as unknown as typeof Worker;
  });
  await start(page);
  await page.getByRole("button", { name: "ヒント", exact: false }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "準備できませんでした",
  );
  await tapPlace(page, solution[0]);
  expect((await records(page))[0].hint_count).toBe(0);
  expect((await records(page))[0].placements).toHaveLength(1);
});

test.describe("fallback ownership without Web Locks", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() =>
      Object.defineProperty(navigator, "locks", { value: undefined }),
    );
  });
  test("competing tab waits and resumes saved placements after the owner closes", async ({
    page,
    context,
  }) => {
    await start(page);
    await tapPlace(page, solution[0]);
    const second = await context.newPage();
    await second.goto("/");
    await second
      .getByRole("button", { name: "続きを遊ぶ →", exact: true })
      .click();
    await expect(second.getByRole("alert")).toContainText("別のタブ");
    await page.close();
    await second
      .getByRole("alert")
      .getByRole("button", { name: "このタブで続ける" })
      .click();
    await expect(second.locator(".board")).toBeVisible();
    expect((await records(second))[0].placements).toHaveLength(1);
  });
  test("a fenced old owner cannot overwrite an explicit takeover even if storage events are delayed", async ({
    page,
    context,
  }) => {
    await page.addInitScript(() => {
      const w = window as typeof window & { freezeOwner?: boolean };
      const interval = window.setInterval.bind(window);
      window.setInterval = ((callback: () => void, delay?: number) =>
        interval(() => {
          if (!w.freezeOwner) callback();
        }, delay)) as typeof window.setInterval;
      window.addEventListener(
        "storage",
        (e) => {
          if (w.freezeOwner) e.stopImmediatePropagation();
        },
        true,
      );
      document.addEventListener(
        "visibilitychange",
        (e) => {
          if (w.freezeOwner) e.stopImmediatePropagation();
        },
        true,
      );
    });
    await start(page);
    await tapPlace(page, solution[0]);
    await page.evaluate(() => {
      (window as typeof window & { freezeOwner?: boolean }).freezeOwner = true;
    });
    const second = await context.newPage();
    await second.goto("/");
    await second
      .getByRole("button", { name: "続きを遊ぶ →", exact: true })
      .click();
    await expect(second.getByRole("alert")).toContainText("別のタブ");
    await second
      .getByRole("button", { name: "このタブで続ける", exact: true })
      .click();
    await expect(second.locator(".board")).toBeVisible();
    await tapPlace(second, solution[1]);
    await expect
      .poll(async () => (await records(second))[0].placements.length)
      .toBe(2);
    const current = await second.evaluate(() =>
      JSON.parse(localStorage.getItem("onebox:v1:current:fixture-011")!),
    );
    expect(current.placements).toHaveLength(2);
    await page.evaluate(() => {
      (window as typeof window & { freezeOwner?: boolean }).freezeOwner = false;
    });
    await expect(page.getByRole("alert")).toContainText("別のタブ");
    expect(
      await second.evaluate(() =>
        JSON.parse(localStorage.getItem("onebox:v1:current:fixture-011")!),
      ),
    ).toMatchObject({
      run_id: current.run_id,
      placements: current.placements,
      hint_count: current.hint_count,
    });
    await second.close();
    await page
      .getByRole("alert")
      .getByRole("button", { name: "このタブで続ける" })
      .click();
    await expect(page.locator(".board")).toBeVisible();
    expect((await records(page))[0].placements).toHaveLength(2);
  });
});

test.describe("short touch viewport", () => {
  test.use({ hasTouch: true });
  for (const width of [320, 390])
    test(`${width}x568 keeps confirmation reachable and completes by touch`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 568 });
      await page.goto("/");
      await page.getByRole("button", { name: "箱を開く" }).tap();
      for (const [step, q] of solution.entries()) {
        await page.locator(`[data-piece="${q.piece_id}"]`).tap();
        for (let i = 0; i < q.rotation; i++)
          await page.getByRole("button", { name: "回転", exact: false }).tap();
        await page.locator(`[data-cell="${q.x},${q.y}"]`).tap();
        const toolbar = await page.locator(".controls").boundingBox();
        expect(toolbar!.y).toBeGreaterThanOrEqual(0);
        expect(toolbar!.y + toolbar!.height).toBeLessThanOrEqual(568);
        await page.getByRole("button", { name: "置く", exact: false }).tap();
        if (step === 0)
          await page.screenshot({
            path: `evidence/short-touch-playing-${width}.png`,
          });
      }
      await expect(
        page.getByRole("heading", { name: "ぴったり！" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `evidence/short-touch-${width}.png`,
        fullPage: true,
      });
    });
});

test("reload restores committed undo history without rolling back hints, time or interruptions", async ({
  page,
}) => {
  await start(page);
  await tapPlace(page, solution[0]);
  await page.getByRole("button", { name: "ヒント", exact: false }).click();
  await expect(page.getByRole("status").first()).toContainText("置き場所");
  await tapPlace(page, solution[1]);
  await page.reload();
  await expect(page.locator(".board")).toHaveCount(0);
  await page.getByRole("button", { name: "続きを遊ぶ →", exact: true }).click();
  const before = (await records(page))[0];
  expect(before.undo_history).toHaveLength(2);
  await page.getByRole("button", { name: "取消", exact: false }).click();
  await expect
    .poll(async () => (await records(page))[0].placements.length)
    .toBe(1);
  const after = (await records(page))[0];
  expect(after.run_id).toBe(before.run_id);
  expect(after.hint_count).toBe(1);
  expect(after.interrupted).toBe(true);
  expect(after.active_elapsed_ms).toBeGreaterThanOrEqual(
    before.active_elapsed_ms,
  );
  await page.getByRole("button", { name: "取消", exact: false }).click();
  await expect
    .poll(async () => (await records(page))[0].placements.length)
    .toBe(0);
});

test("restart and reveal cancellation preserve the first run; confirmed restart records abandonment", async ({
  page,
}) => {
  await start(page);
  await tapPlace(page, solution[0]);
  const first = (await records(page))[0];
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "もう一度練習", exact: false })
    .click();
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "解答を見る", exact: true }).click();
  expect((await records(page))[0]).toMatchObject({
    run_id: first.run_id,
    state: "playing",
    placements: first.placements,
  });
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "もう一度練習", exact: false })
    .click();
  await expect(page.locator(".puzzle-id")).toContainText("練習");
  await expect.poll(async () => (await records(page)).length).toBe(2);
  expect(
    (await records(page)).find((a) => a.run_id === first.run_id),
  ).toMatchObject({
    mode: "first",
    state: "abandoned",
    placements: first.placements,
  });
});

test("lost pointer capture cancels a drag and foreign pointerup does not commit it", async ({
  page,
}) => {
  await start(page);
  await tapPlace(page, solution[0]);
  const before = (await records(page))[0];
  const cell = occupied(puzzle, solution[0])[0],
    source = page.locator(`[data-cell="${cell}"]`),
    box = await source.boundingBox();
  await page.mouse.move(box!.x + 15, box!.y + 15);
  await page.mouse.down();
  await page.mouse.move(box!.x + 80, box!.y + 80, { steps: 4 });
  await expect(page.locator(".drag-ghost")).toBeVisible();
  await source.dispatchEvent("pointerup", {
    pointerId: 99,
    pointerType: "pen",
  });
  await expect(page.locator(".drag-ghost")).toBeVisible();
  await source.dispatchEvent("lostpointercapture", {
    pointerId: 1,
    pointerType: "mouse",
  });
  await page.mouse.up();
  await expect(page.locator(".drag-ghost")).toHaveCount(0);
  expect((await records(page))[0]).toMatchObject({
    placements: before.placements,
    undo_history: before.undo_history,
  });
});

for (const fallback of [false, true]) {
  test(`simultaneous first claims use ${fallback ? "IndexedDB" : "Web Locks"} exclusion`, async ({
    page,
    context,
  }) => {
    if (fallback)
      await context.addInitScript(() =>
        Object.defineProperty(navigator, "locks", { value: undefined }),
      );
    const second = await context.newPage();
    await Promise.all([page.goto("/"), second.goto("/")]);
    await Promise.all([
      page.getByRole("button", { name: "箱を開く" }).click(),
      second.getByRole("button", { name: "箱を開く" }).click(),
    ]);
    await expect
      .poll(
        async () =>
          (await records(page)).filter((a) => a.mode === "first").length,
      )
      .toBe(1);
    await expect
      .poll(
        async () =>
          (await page.getByRole("alert").count()) +
          (await second.getByRole("alert").count()),
      )
      .toBe(1);
    expect(await records(page)).toHaveLength(1);
  });
}

test("explicit Web Locks takeover stops the original tab and preserves the run", async ({
  page,
  context,
}) => {
  await start(page);
  await tapPlace(page, solution[0]);
  const first = (await records(page))[0],
    second = await context.newPage();
  await second.goto("/");
  await second
    .getByRole("button", { name: "続きを遊ぶ →", exact: true })
    .click();
  await second
    .getByRole("button", { name: "このタブで続ける", exact: true })
    .click();
  await expect(second.locator(".board")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("別のタブ");
  await tapPlace(second, solution[1]);
  await expect
    .poll(async () => (await records(second))[0].placements.length)
    .toBe(2);
  expect((await records(second))[0]).toMatchObject({
    run_id: first.run_id,
    mode: "first",
    interrupted: true,
  });
});

test("without either exclusion API the game uses unsaved practice and preserves shared records", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "locks", { value: undefined });
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw Error("disabled");
      },
    });
  });
  await start(page);
  await expect(page.locator(".puzzle-id")).toContainText("練習");
  for (const q of solution) await tapPlace(page, q);
  await expect(page.getByRole("heading", { name: "ぴったり！" })).toBeVisible();
  expect(await records(page)).toHaveLength(0);
  await expect(page.locator(".badge")).toHaveCount(0);
  await expect(page.locator(".notice")).toContainText("保存");
});

test("hidden time suppresses the achievement badge and persists after completed-result reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("checkbox", { name: "時間を表示" }).uncheck();
  await page.getByRole("button", { name: "箱を開く" }).click();
  for (const q of solution) await tapPlace(page, q);
  await expect(page.getByRole("heading", { name: "ぴったり！" })).toBeVisible();
  await expect(page.locator(".badge")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "ぴったり！" })).toBeVisible();
  await expect(page.locator(".clock, .badge")).toHaveCount(0);
});

test("stale worker response after a committed placement never displays or counts a hint", async ({
  page,
}) => {
  await page.addInitScript((sol) => {
    class HeldWorker {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror = null;
      postMessage() {
        (window as any).deliverHint = () =>
          this.onmessage?.({ data: { solution: sol } });
        this.onmessage?.({ data: { ready: true } });
      }
      terminate() {}
    }
    Object.defineProperty(window, "Worker", { value: HeldWorker });
  }, solution);
  await start(page);
  await page.getByRole("button", { name: "ヒント", exact: false }).click();
  await tapPlace(page, solution[0]);
  await page.evaluate(() => (window as any).deliverHint());
  expect((await records(page))[0].hint_count).toBe(0);
  await expect(page.locator(".hint-cell")).toHaveCount(0);
});

test("duplicate final click saves exactly one immutable completed result", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    (window as any).completedWrites = 0;
    Storage.prototype.setItem = function (key, value) {
      if (
        key.startsWith("onebox:v1:run:") &&
        JSON.parse(value).state === "completed"
      )
        (window as any).completedWrites++;
      return set.call(this, key, value);
    };
  });
  await start(page);
  for (const q of solution.slice(0, -1)) await tapPlace(page, q);
  const q = solution[solution.length - 1];
  await page.locator(`[data-piece="${q.piece_id}"]`).click();
  for (let i = 0; i < q.rotation; i++)
    await page.getByRole("button", { name: "回転", exact: false }).click();
  await page.locator(`[data-cell="${q.x},${q.y}"]`).click();
  await page
    .locator(".controls .primary")
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page.getByRole("heading", { name: "ぴったり！" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).completedWrites))
    .toBe(1);
  const first = (await records(page))[0];
  await page.reload();
  await expect(page.getByRole("heading", { name: "ぴったり！" })).toBeVisible();
  expect((await records(page))[0]).toEqual(first);
});

test("duplicate start activation creates one first run without a false tab conflict", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "箱を開く" })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page.locator(".board")).toBeVisible();
  await expect.poll(async () => (await records(page)).length).toBe(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
