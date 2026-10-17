import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { selectPublishedProblem } from "../packages/game-core/release.ts";

export async function serveProduction(
  req,
  res,
  path,
  search,
  root,
  assetRoot,
  info,
) {
  const { manifest, archive, practice } = info;
  res.setHeader("X-Robots-Tag", "index, follow");
  function send(status, body, type = "text/plain; charset=utf-8") {
    res.writeHead(status, { "Content-Type": type });
    res.end(req.method === "HEAD" ? undefined : body);
  }
  if (path === "/health")
    return send(
      200,
      JSON.stringify({
        status: "ok",
        stage: "daily",
        edition: manifest.active.edition_utc,
        release_status: manifest.release_status,
      }),
      "application/json; charset=utf-8",
    );
  if (path === "/robots.txt") return send(200, "User-agent: *\nAllow: /\n");
  const fixed = /^\/(ja|en)\/p\/playtest-fixed-v1\/$/.test(path),
    selected = selectPublishedProblem(
      fixed ? practice : manifest,
      path,
      search,
      fixed ? undefined : archive,
    );
  let file,
    type,
    status = 200,
    fileRoot = root;
  if (selected) {
    if (selected.status === "recalled") {
      const ja = !path.startsWith("/en/");
      return send(
        410,
        `<!doctype html><html lang="${ja ? "ja" : "en"}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ONEBOX</title><body><main><h1>ONEBOX</h1><p>${ja ? "この問題は公開を取り下げました。" : "This puzzle has been withdrawn."}</p><a href="/${ja ? "ja" : "en"}/">${ja ? "トップへ戻る" : "Back to ONEBOX"}</a></main></body></html>`,
        "text/html; charset=utf-8",
      );
    }
    status = selected.status === "unavailable" ? 503 : 200;
    file = ["/", "/index.html"].includes(path)
      ? "index.html"
      : path.slice(1) + "index.html";
    type = "text/html; charset=utf-8";
  } else if (
    !search &&
    ["/release.json", "/practice-release.json", manifest.archive.url].includes(
      path,
    )
  ) {
    file = path.slice(1);
    type = "application/json; charset=utf-8";
  } else if (
    !search &&
    [...archive.entries, practice.active].some(
      (e) =>
        e.payload_url === path && !manifest.recalled_ids.includes(e.puzzle_id),
    )
  ) {
    file = path.slice(1);
    type = "application/json; charset=utf-8";
  } else if (
    !search &&
    /^\/assets\/(?:[\w.-]+\.(js|css)|onebox-cover-[a-f0-9]{12}\.png)$/.test(
      path,
    )
  ) {
    file = path.slice("/assets/".length);
    fileRoot = await realpath(assetRoot);
    type = path.endsWith(".css")
      ? "text/css; charset=utf-8"
      : path.endsWith(".png")
        ? "image/png"
        : "text/javascript; charset=utf-8";
  } else return send(404, "Not found");
  try {
    const target = await realpath(resolve(fileRoot, file));
    if (!target.startsWith(fileRoot + sep)) throw Error("Outside root");
    const data = await readFile(target);
    if (
      type !== "text/html; charset=utf-8" &&
      !["release.json", "practice-release.json"].includes(file)
    )
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    send(status, data, type);
  } catch {
    send(404, "Not found");
  }
}
