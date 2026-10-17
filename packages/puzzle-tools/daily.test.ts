import { it, expect } from "vitest";
import { prepareDaily } from "./daily.ts";
import { emptyCatalog } from "./curation.ts";
import { digest } from "./generator.ts";
import { inventory } from "./inventory.ts";
import { syntheticQualityCatalog } from "../../tests/helpers/quality-catalog.ts";
const at = "2026-10-14T00:00:01.000Z";
it("blocks unreviewed stock and future/backdated editions without mutating the real-empty model", () => {
  const c = emptyCatalog(),
    before = digest(c);
  expect(() => prepareDaily(c, "candidate-none", "2026-10-14", at)).toThrow(
    "30",
  );
  expect(() => prepareDaily(c, "candidate-none", "2026-10-15", at)).toThrow(
    "future",
  );
  expect(() => prepareDaily(c, "candidate-none", "2026-10-13", at)).toThrow(
    "backdated",
  );
  expect(() => prepareDaily(c, "candidate-none", "2026-02-30", at)).toThrow(
    "edition",
  );
  expect(digest(c)).toBe(before);
});
it("prepares one final canonical payload from 30 synthetic queued entries, with independent solvers; refuses ID reuse", () => {
  const c = syntheticQualityCatalog(at);
  expect(inventory(c, at).ready).toBe(30);
  const before = digest(c),
    result = prepareDaily(c, c.entries[0].puzzle.puzzle_id, "2026-10-14", at);
  expect(result.manifest.active.puzzle_id).toBe("onebox-2026-10-14");
  expect(result.manifest.next_update_at).toBe("2026-10-15T00:00:00.000Z");
  expect(result.payload_json).not.toMatch(
    /seed|solution|construction|trials|reviewer|PRIVATE/,
  );
  expect(digest(JSON.parse(result.payload_json))).toBe(
    result.manifest.active.sha256,
  );
  expect(digest(c)).toBe(before);
  expect(() =>
    prepareDaily(
      c,
      c.entries[0].puzzle.puzzle_id,
      "2026-10-14",
      at,
      result.manifest,
    ),
  ).toThrow("immutable");
}, 10000);
