import { type Attempt, type Puzzle, validateAttempt } from "./index.ts";
import type { Trial } from "../puzzle-tools/curation.ts";

// An automatic observation is a draft, never evidence of a human trial.
export interface Observation {
  kind: "browser_observation";
  attempt: Attempt;
  locale: "ja" | "en";
  first_piece_placed: boolean;
}
export function observe(
  attempt: Attempt,
  locale: "ja" | "en",
  previous?: Observation,
): Observation {
  return {
    kind: "browser_observation",
    attempt: structuredClone(attempt),
    locale,
    first_piece_placed:
      (attempt.state !== "revealed" && attempt.placements.length > 0) ||
      (previous?.attempt.run_id === attempt.run_id &&
        previous.first_piece_placed) ||
      false,
  };
}
export function humanReport(
  observation: Observation,
  puzzle: Puzzle,
  hash: string,
  choices: {
    confirmed: boolean;
    device: Trial["device"];
    input: Trial["input"];
    confusion: Trial["confusion"];
  },
): Trial {
  if (!choices.confirmed)
    throw Error("実際の操作結果であることを確認してください。");
  if (
    observation.kind !== "browser_observation" ||
    typeof observation.first_piece_placed !== "boolean" ||
    !["ja", "en"].includes(observation.locale) ||
    !["phone", "desktop"].includes(choices.device) ||
    !["touch", "drag", "keyboard"].includes(choices.input) ||
    !["none", "anchor", "rotation", "drag", "other"].includes(choices.confusion)
  )
    throw Error("試遊記録の入力を確認してください。");
  const a = validateAttempt(observation.attempt, puzzle, hash);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(a.run_id))
    throw Error("試遊の識別子が不正です。");
  if (a.mode === "tutorial" || a.clock_status === "uncertain")
    throw Error("チュートリアルや時計が不確かな試遊は取り込めません。");
  const elapsed = Math.round(a.active_elapsed_ms);
  if (elapsed < 1 || elapsed > 86400000 || a.hint_count > 100)
    throw Error("時間またはヒント数が試遊記録の範囲外です。");
  return {
    kind: "human_report",
    trial_id: a.run_id,
    device: choices.device,
    input: choices.input,
    locale: observation.locale,
    attempt_mode: a.mode,
    outcome: a.state === "completed" ? "completed" : "unfinished",
    active_elapsed_ms: elapsed,
    hint_count: a.hint_count,
    interrupted: a.interrupted,
    first_piece_placed:
      observation.first_piece_placed ||
      (a.state !== "revealed" && a.placements.length > 0),
    confusion: choices.confusion,
  };
}
