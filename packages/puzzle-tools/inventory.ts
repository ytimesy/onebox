import {
  checkEntry,
  trialSummary,
  validateCatalog,
  type Trial,
} from "./curation.ts";
import { verify } from "./generator.ts";

export function stockLevel(ready: number) {
  if (!Number.isSafeInteger(ready) || ready < 0)
    throw Error("Invalid stock count");
  return {
    level:
      ready < 7
        ? ("action_required" as const)
        : ready < 14
          ? ("warning" as const)
          : ("ok" as const),
    target: 30,
    shortfall: Math.max(0, 30 - ready),
  };
}
function cohort(trials: Trial[]) {
  const summary = trialSummary(trials);
  return {
    starts: summary.starts,
    completed: summary.completed,
    unfinished: summary.unfinished,
    completion_rate: summary.starts ? summary.completed / summary.starts : null,
    unfinished_rate: summary.starts
      ? summary.unfinished / summary.starts
      : null,
    completion_median_ms: summary.completion_median_ms,
    first_piece_placed: summary.first_piece_placed,
    used_hint: summary.used_hint,
    interrupted: summary.interrupted,
    confused: summary.confused,
  };
}

// Read-only report. Stored queued stages alone never prove current eligibility.
export function inventory(raw: unknown, checkedAt = new Date().toISOString()) {
  const c = validateCatalog(raw);
  if (!Number.isFinite(Date.parse(checkedAt)))
    throw Error("Invalid check time");
  const counts = {
    candidate: 0,
    playtesting: 0,
    approved: 0,
    queued: 0,
    rejected: 0,
  };
  const excluded = { duplicate: 0, stale_review: 0, machine_verification: 0 };
  let ready = 0;
  const verificationDeadline = performance.now() + 3000;
  for (const e of c.entries) {
    counts[e.stage]++;
    if (e.stage !== "queued") continue;
    const check = checkEntry(c, e);
    // Exclusion reasons are mutually exclusive, in this priority order.
    if (check.duplicates.length) excluded.duplicate++;
    else if (e.review?.check_hash !== check.check_hash) excluded.stale_review++;
    else {
      const remaining = Math.floor(verificationDeadline - performance.now());
      if (remaining < 1) {
        excluded.machine_verification++;
        continue;
      }
      const v = verify(e.puzzle, 100000, Math.min(1500, remaining));
      if (v.status !== "unique" || v.hash !== e.verification.hash)
        excluded.machine_verification++;
      else ready++;
    }
  }
  // Retain reports of rejected candidates so unsuccessful trials do not disappear.
  const trials = c.entries.flatMap((e) => e.trials);
  return {
    revision: c.revision,
    checked_at: checkedAt,
    counts,
    ready,
    excluded,
    stock: stockLevel(ready),
    trials: {
      all: cohort(trials),
      first: cohort(trials.filter((t) => t.attempt_mode === "first")),
      practice: cohort(trials.filter((t) => t.attempt_mode === "practice")),
      phone_first: cohort(
        trials.filter(
          (t) => t.attempt_mode === "first" && t.device === "phone",
        ),
      ),
    },
  };
}
export type Inventory = ReturnType<typeof inventory>;
