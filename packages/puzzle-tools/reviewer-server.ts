import { createServer, type ServerResponse } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PrivateStore, safeName } from "./private-store.ts";
import { checkEntry, findEntry } from "./curation.ts";
import { verify } from "./generator.ts";
import { inventory } from "./inventory.ts";

const project = fileURLToPath(new URL("../../", import.meta.url));
export function createReviewerServer(
  store = new PrivateStore(),
  root = resolve(project, "var/reviewer"),
) {
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
    );
    function send(
      status: number,
      data = "",
      type = "text/plain; charset=utf-8",
    ) {
      res.writeHead(status, { "Content-Type": type });
      res.end(req.method === "HEAD" ? undefined : data);
    }
    const port = (server.address() as { port: number }).port;
    const allowedHosts = [`localhost:${port}`, `127.0.0.1:${port}`];
    // Binding to loopback alone does not stop DNS rebinding or cross-site reads.
    if (!allowedHosts.includes(req.headers.host ?? "")) return send(403);
    if (
      (req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}`) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      return send(403);
    if (!["GET", "HEAD"].includes(req.method ?? "")) {
      res.setHeader("Allow", "GET, HEAD");
      return send(405);
    }
    let path: string;
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      if (url.host !== req.headers.host || url.search) return send(404);
      path = decodeURIComponent(url.pathname);
    } catch {
      return send(400);
    }
    try {
      if (path === "/api/inventory")
        return json(res, req.method, inventory(await store.read()));
      if (path === "/api/candidates") {
        const c = await store.read();
        return json(res, req.method, {
          entries: c.entries
            .filter((e) => ["candidate", "playtesting"].includes(e.stage))
            .map((e) => ({
              id: e.puzzle.puzzle_id,
              stage: e.stage,
              eligible: checkEntry(c, e).duplicates.length === 0,
              recorded_trials: e.trials.length,
            })),
        });
      }
      const selected = path.match(
        /^\/api\/candidate\/(candidate-[a-f0-9]{12})$/,
      );
      if (selected) {
        const c = await store.read();
        const e = c.entries.find((e) => e.puzzle.puzzle_id === selected[1]);
        if (!e || !["candidate", "playtesting"].includes(e.stage))
          return send(404);
        if (checkEntry(c, findEntry(c, selected[1])).duplicates.length)
          return send(409);
        const v = verify(e.puzzle);
        if (v.status !== "unique" || v.hash !== e.verification.hash)
          return send(409);
        // Deliberately select fields: no envelope, source, seed or stored answer.
        return json(res, req.method, { puzzle: e.puzzle, hash: v.hash });
      }
      if (path === "/robots.txt")
        return send(200, "User-agent: *\nDisallow: /\n");
      const html = ["/", "/index.html"].includes(path);
      if (!html && !/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(path))
        return send(404);
      const actualRoot = await realpath(root);
      const file = await realpath(
        resolve(actualRoot, html ? "index.html" : path.slice(1)),
      );
      if (!file.startsWith(actualRoot + sep)) return send(404);
      send(
        200,
        await readFile(file, "utf8"),
        html
          ? "text/html; charset=utf-8"
          : path.endsWith(".css")
            ? "text/css; charset=utf-8"
            : "text/javascript; charset=utf-8",
      );
    } catch {
      // Do not send private parser errors, paths or payloads to the browser/log.
      send(path.startsWith("/api/") ? 503 : 404);
    }
  });
  return server;
}
function json(res: ServerResponse, method: string | undefined, value: unknown) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(method === "HEAD" ? undefined : JSON.stringify(value));
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.ONEBOX_REVIEW_PORT ?? 4324);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw Error("Invalid reviewer port");
  const server = createReviewerServer(
    new PrivateStore(safeName(process.env.ONEBOX_REVIEW_WORKSPACE ?? "main")),
  );
  server.listen(port, "127.0.0.1", () =>
    console.log(
      `ONEBOX private reviewer: http://localhost:${(server.address() as { port: number }).port}/`,
    ),
  );
  function close() {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  }
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
}
