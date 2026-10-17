import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  validateManifest,
  selectPublishedProblem,
  validatePublishedArchive,
} from "../packages/game-core/release.ts";
const root = await realpath(
  resolve(process.env.ONEBOX_DAILY_PREVIEW_ROOT ?? "evidence/daily-preview"),
);
if (
  (await readFile(`${root}/.LOCAL_SIMULATION`, "utf8")) !==
  "ONEBOX synthetic daily preview v1\n"
)
  throw Error("Local simulation marker required");
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  );
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405);
    res.end();
    return;
  }
  try {
    const { pathname, search } = new URL(req.url, "http://localhost");
    const manifest = validateManifest(
      JSON.parse(await readFile(`${root}/release.json`, "utf8")),
    );
    const archive = manifest.archive
      ? await validatePublishedArchive(
          JSON.parse(await readFile(root + manifest.archive.url, "utf8")),
          manifest,
        )
      : undefined;
    const selected = selectPublishedProblem(
      manifest,
      pathname,
      search,
      archive,
    );
    let file,
      type,
      status = 200;
    if (selected) {
      if (selected.status === "recalled") {
        const locale = pathname.startsWith("/en/") ? "en" : "ja";
        let stylesheet = "";
        try {
          stylesheet =
            (await readFile(`${root}/${locale}/index.html`, "utf8")).match(
              /href="(\/assets\/[\w.-]+\.css)"/,
            )?.[1] ?? "";
        } catch {
          /* The withdrawn response remains available without styling. */
        }
        res.writeHead(410, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><html lang="${locale}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ONEBOX</title>${stylesheet ? `<link rel="stylesheet" href="${stylesheet}">` : ""}<body><main><h1>ONEBOX</h1><p>${locale === "ja" ? "この問題は公開を取り下げました。" : "This puzzle has been withdrawn."}</p><p><a class="navigation-link" href="/${locale}/">${locale === "ja" ? "トップへ戻る" : "Back to ONEBOX"}</a></p></main></body></html>`,
        );
        return;
      }
      if (selected.status === "unavailable") status = 503;
      file =
        pathname === "/" || pathname === "/index.html"
          ? "ja/index.html"
          : /^\/(ja|en)\/p\//.test(pathname) && archive
            ? pathname.startsWith("/en/")
              ? "en/index.html"
              : "ja/index.html"
            : pathname.slice(1) + "index.html";
      type = "text/html";
    } else if (!search && pathname === "/release.json") {
      file = "release.json";
      type = "application/json";
    } else if (!search && pathname === manifest.archive?.url) {
      file = pathname.slice(1);
      type = "application/json";
    } else if (
      !search &&
      (archive?.entries ?? manifest.recent).some(
        (p) =>
          p.payload_url === pathname &&
          !manifest.recalled_ids.includes(p.puzzle_id),
      )
    ) {
      file = pathname.slice(1);
      type = "application/json";
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else if (!search && /^\/assets\/[\w.-]+\.(js|css)$/.test(pathname)) {
      file = pathname.slice(1);
      type = pathname.endsWith(".css") ? "text/css" : "text/javascript";
    } else {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const target = await realpath(resolve(root, file));
    if (!target.startsWith(root + sep)) throw Error();
    let data = await readFile(target);
    if (
      type === "text/html" &&
      /^\/(ja|en)\/p\/onebox-\d{4}-\d{2}-\d{2}\/$/.test(pathname)
    ) {
      data = Buffer.from(
        data
          .toString("utf8")
          .replace(
            /<link rel="canonical"[^>]*>/,
            `<link rel="canonical" href="http://127.0.0.1:${server.address().port}${pathname}"/>`,
          ),
      );
    }
    res.writeHead(status, { "Content-Type": type + "; charset=utf-8" });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
server.listen(
  Number(process.env.ONEBOX_DAILY_PREVIEW_PORT ?? 4327),
  "127.0.0.1",
  () =>
    console.log(
      `ONEBOX LOCAL daily simulation http://127.0.0.1:${server.address().port}`,
    ),
);
process.on("SIGTERM", () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
