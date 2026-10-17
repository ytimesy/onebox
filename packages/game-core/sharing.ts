import { secondsText, type Attempt } from "./index.ts";
import {
  fixedPath,
  publicOrigin,
  publicPracticeId,
  type PublicLocale,
} from "./public-route.ts";
import type { PublishedProblem } from "./release.ts";

export function shareContent(
  a: Attempt,
  locale: PublicLocale,
  origin = publicOrigin,
  published?: PublishedProblem,
) {
  const target = new URL(origin);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  if (
    target.origin !== origin ||
    target.username ||
    target.password ||
    (origin !== publicOrigin &&
      !(local && ["http:", "https:"].includes(target.protocol)))
  )
    throw Error("Unverified share origin");
  if (
    (published
      ? published.puzzle_id !== a.puzzle_id ||
        published.purpose !== "production_daily" ||
        published.slug !== a.puzzle_id ||
        !/^onebox-\d{4}-\d{2}-\d{2}$/.test(a.puzzle_id)
      : a.puzzle_id !== publicPracticeId) ||
    a.state !== "completed" ||
    !(published
      ? ["first", "practice"].includes(a.mode)
      : a.mode === "practice")
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
    ...(local
      ? [
          ja
            ? "ローカル試遊用リンク（このPC用）"
            : "Local playtest link (this computer only)",
        ]
      : []),
    published
      ? `#${published.edition_utc}`
      : ja
        ? "固定問題 · 試遊版"
        : "Fixed puzzle · Playtest",
    ja ? "4つ、ぴったり。" : "Four pieces. One perfect fit.",
    ...(a.timer_visible && a.clock_status !== "uncertain"
      ? [
          ja
            ? `${secondsText(a.active_elapsed_ms)}秒`
            : `${secondsText(a.active_elapsed_ms)} seconds`,
        ]
      : []),
    ja
      ? `${a.mode === "first" ? "初回" : "練習"} · ヒント${a.hint_count}回 · ${a.interrupted ? "中断あり" : "中断なし"}`
      : `${a.mode === "first" ? "First attempt" : "Practice"} · Hints ${a.hint_count} · ${a.interrupted ? "Interrupted" : "Uninterrupted"}`,
    ja
      ? "このブラウザーの自己記録です。"
      : "A personal record in this browser.",
    ja ? "同じ箱、あなたは解ける？" : "Can you fit the same box?",
  ];
  return {
    title: "ONEBOX",
    text: "ONEBOX\n" + lines.join("\n"),
    lines,
    url:
      origin +
      (published ? `/${locale}/p/${published.slug}/` : fixedPath(locale)) +
      "?src=share",
  };
}
export type ShareContent = ReturnType<typeof shareContent>;

export function xPostUrl(content: ShareContent) {
  const url = new URL("https://x.com/intent/tweet");
  url.searchParams.set("text", content.text);
  url.searchParams.set("url", content.url);
  return url.href;
}
