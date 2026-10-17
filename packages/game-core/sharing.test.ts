import { it, expect } from "vitest";
import type { Attempt } from "./index.ts";
import { shareContent } from "./sharing.ts";
import { publicRoute, fixedPath, publicOrigin } from "./public-route.ts";

const result: Attempt = {
  record_version: 1,
  run_id: "private-run-should-not-escape",
  puzzle_id: "playtest-fixed-v1",
  puzzle_hash: "0".repeat(64),
  rules_version: "onebox-v1",
  mode: "practice",
  state: "completed",
  placements: [{ piece_id: "A", rotation: 2, x: 4, y: 3 }],
  active_elapsed_ms: 53421,
  interrupted: true,
  clock_status: "resumed",
  hint_count: 2,
  timer_visible: true,
  started_at_client: "2026-10-12T00:00:00.000Z",
  finished_at_client: "2026-10-12T00:01:00.000Z",
};
it("shares an immutable released URL and honest result fields without IDs, solution or referral identity", () => {
  for (const locale of ["ja", "en"] as const) {
    const c = shareContent(result, locale);
    expect(c.url).toBe(publicOrigin + fixedPath(locale) + "?src=share");
    expect(c.text).toContain("53.5");
    expect(c.text).toContain(locale === "ja" ? "ヒント2回" : "Hints 2");
    expect(c.text).toContain(locale === "ja" ? "中断あり" : "Interrupted");
    expect(c.text).toContain(locale === "ja" ? "練習" : "Practice");
    expect(JSON.stringify(c)).not.toMatch(
      /private-run|puzzle_hash|placements|rotation|started_at|finished_at|公式スコア|Official score/,
    );
    expect(
      shareContent(
        { ...result, run_id: "another-private-run", placements: [] },
        locale,
      ),
    ).toEqual(c);
  }
});
it("omits hidden or uncertain time from every shared representation", () => {
  for (const a of [
    { ...result, timer_visible: false },
    { ...result, clock_status: "uncertain" as const },
  ])
    for (const locale of ["ja", "en"] as const)
      expect(JSON.stringify(shareContent(a, locale))).not.toMatch(
        /53\.5|秒|seconds/,
      );
});
it("never shares private candidates, solution-only results, unfinished or tutorial runs", () => {
  for (const a of [
    { ...result, puzzle_id: "candidate-35bad118a3d8" },
    { ...result, state: "revealed" as const },
    { ...result, state: "abandoned" as const },
    { ...result, mode: "tutorial" as const },
    { ...result, active_elapsed_ms: Infinity },
  ])
    expect(() => shareContent(a, "ja")).toThrow();
});
it("allows only released locale/slug and the exact share source, independently of date/time zone", () => {
  for (const locale of ["ja", "en"] as const) {
    const route = publicRoute(fixedPath(locale), "?src=share");
    expect(route).toMatchObject({ locale, fixed: true });
    expect(publicRoute(fixedPath(locale))).toEqual(route);
  }
  for (const path of [
    "/fr/",
    "/ja/p/future/",
    "/ja/p/playtest-fixed-v1",
    "/ja/p/candidate-35bad118a3d8/",
    "/ja/p/" + "a".repeat(5000) + "/",
  ])
    expect(publicRoute(path)).toBeNull();
  for (const query of [
    "?src=other",
    "?src=share&src=share",
    "?run_id=private",
    "?time=53",
    "?src=%73hare",
    "?src=share&next=https://evil.example",
  ])
    expect(publicRoute(fixedPath("ja"), query)).toBeNull();
});

it("labels a loopback link as local and rejects an unverified external origin", () => {
  const c = shareContent(result, "ja", "http://127.0.0.1:4326");
  expect(c.url).toBe("http://127.0.0.1:4326" + fixedPath("ja") + "?src=share");
  expect(c.text).toContain("ローカル試遊用");
  for (const origin of [
    "https://invalid.example",
    publicOrigin + "/path",
    "http://127.0.0.1:4326/path",
    "javascript:alert(1)",
  ])
    expect(() => shareContent(result, "en", origin)).toThrow();
});
