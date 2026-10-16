import { useEffect, useRef, useState } from "react";
import type { Attempt } from "../../../packages/game-core/index.ts";
import {
  shareContent,
  type ShareContent,
} from "../../../packages/game-core/sharing.ts";
import type { Locale } from "./i18n";

async function resultImage(content: ShareContent) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 800;
  const c = canvas.getContext("2d");
  if (!c) throw Error("Canvas unavailable");
  c.fillStyle = "#f4f1e9";
  c.fillRect(0, 0, 1200, 800);
  c.fillStyle = "#19342f";
  c.font = "bold 76px sans-serif";
  c.fillText(content.title, 60, 110);
  c.font = "34px sans-serif";
  content.lines.forEach((line, i) => c.fillText(line, 60, 200 + i * 72, 1080));
  c.font = "24px sans-serif";
  c.fillText(content.url, 60, 750, 1080);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(Error("Image unavailable"))),
      "image/png",
    ),
  );
}
export default function ShareResult({
  attempt,
  locale,
}: {
  attempt: Attempt;
  locale: Locale;
}) {
  const [open, setOpen] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    preview = useRef<HTMLTextAreaElement>(null);
  const ja = locale === "ja",
    content = shareContent(attempt, locale),
    value = content.text + "\n" + content.url;
  let canShare = false;
  try {
    canShare =
      typeof navigator.share === "function" &&
      (!navigator.canShare ||
        navigator.canShare({
          title: content.title,
          text: content.text,
          url: content.url,
        }));
  } catch {
    /* Use copy/text alternatives. */
  }
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  async function share() {
    setMessage("");
    try {
      // Call directly from the click: user activation belongs to this operation.
      await navigator.share({
        title: content.title,
        text: content.text,
        url: content.url,
      });
      setMessage(
        ja
          ? "共有先に渡しました。投稿完了は共有先で確認してください。"
          : "Passed to the share destination. Check there to confirm posting.",
      );
    } catch (e) {
      setMessage(
        (e as DOMException).name === "AbortError"
          ? ja
            ? "共有を閉じました。"
            : "Share sheet closed."
          : ja
            ? "共有先を開けませんでした。コピーまたはテキストの選択を使えます。"
            : "Could not open sharing. Copy or select the text instead.",
      );
    }
  }
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw Error();
      await navigator.clipboard.writeText(value);
      setMessage(
        ja ? "共有文とリンクをコピーしました。" : "Text and link copied.",
      );
    } catch {
      preview.current?.focus();
      preview.current?.select();
      setMessage(
        ja
          ? "コピーできませんでした。選択したテキストを手動でコピーしてください。"
          : "Could not copy. Manually copy the selected text.",
      );
    }
  }
  async function image() {
    setBusy(true);
    setMessage("");
    try {
      const url = URL.createObjectURL(await resultImage(content)),
        link = document.createElement("a");
      link.href = url;
      link.download = `onebox-playtest-${locale}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setMessage(
        ja
          ? "結果画像の保存を開始しました。"
          : "Result image download started.",
      );
    } catch {
      setMessage(
        ja
          ? "画像を作成できませんでした。共有文とリンクを使えます。"
          : "Could not create the image. Use text and link instead.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="primary"
        onClick={() => {
          setMessage("");
          setOpen(true);
        }}
      >
        {ja ? "この問題を友達に送る" : "Send this puzzle to a friend"}
      </button>
      <dialog
        ref={dialog}
        className="share-dialog"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
      >
        <div className="dialog-header">
          <h2>{ja ? "共有内容を確認" : "Preview your share"}</h2>
          <button
            onClick={() => setOpen(false)}
            aria-label={ja ? "閉じる" : "Close"}
          >
            ×
          </button>
        </div>
        <p>
          {ja
            ? "解答や操作順は含みません。受け取った人は同じ固定問題を遊べます。"
            : "No solution or moves are included. Your friend can play the same fixed puzzle."}
        </p>
        <label htmlFor="share-preview">
          {ja ? "共有するテキストとリンク" : "Text and link to share"}
        </label>
        <textarea
          id="share-preview"
          ref={preview}
          readOnly
          value={value}
          rows={10}
        />
        <div className="share-actions">
          {canShare && (
            <button onClick={() => void share()}>
              {ja ? "共有先を選ぶ" : "Choose a share destination"}
            </button>
          )}
          <button onClick={() => void copy()}>
            {ja ? "共有文とリンクをコピー" : "Copy text and link"}
          </button>
          <button
            onClick={() => {
              preview.current?.focus();
              preview.current?.select();
            }}
          >
            {ja ? "テキストを選択" : "Select text"}
          </button>
          <button disabled={busy} onClick={() => void image()}>
            {ja ? "結果画像を保存" : "Save result image"}
          </button>
        </div>
        {!canShare && (
          <p>
            {ja
              ? "このブラウザーではリンクコピーから共有できます。"
              : "Share using copied text and link in this browser."}
          </p>
        )}
        {message && (
          <p className="share-message" role="status">
            {message}
          </p>
        )}
      </dialog>
    </>
  );
}
