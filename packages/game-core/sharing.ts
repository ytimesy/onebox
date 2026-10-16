import type { Attempt } from "./index.ts";
import {
  fixedPath,
  publicOrigin,
  publicPracticeId,
  type PublicLocale,
} from "./public-route.ts";

export function shareContent(a: Attempt, locale: PublicLocale) {
  if (
    a.puzzle_id !== publicPracticeId ||
    a.state !== "completed" ||
    a.mode !== "practice"
  )
    throw Error("Only the released completed practice puzzle may be shared");
  if (
    !Number.isFinite(a.active_elapsed_ms) ||
    a.active_elapsed_ms < 0 ||
    !Number.isInteger(a.hint_count) ||
    a.hint_count < 0
  )
    throw Error("Invalid result metrics");
  const ja = locale === "ja";
  const lines = [
    ja ? "固定問題 · 試遊版" : "Fixed puzzle · Playtest",
    ja ? "4つ、ぴったり。" : "Four pieces. One perfect fit.",
    ...(a.timer_visible && a.clock_status !== "uncertain"
      ? [
          ja
            ? `${(a.active_elapsed_ms / 1000).toFixed(1)}秒`
            : `${(a.active_elapsed_ms / 1000).toFixed(1)} seconds`,
        ]
      : []),
    ja
      ? `練習 · ヒント${a.hint_count}回 · ${a.interrupted ? "中断あり" : "中断なし"}`
      : `Practice · Hints ${a.hint_count} · ${a.interrupted ? "Interrupted" : "Uninterrupted"}`,
    ja
      ? "このブラウザーの自己記録です。"
      : "A personal record in this browser.",
    ja ? "同じ箱、あなたは解ける？" : "Can you fit the same box?",
  ];
  return {
    title: "ONEBOX",
    text: "ONEBOX\n" + lines.join("\n"),
    lines,
    url: publicOrigin + fixedPath(locale) + "?src=share",
  };
}
export type ShareContent = ReturnType<typeof shareContent>;
