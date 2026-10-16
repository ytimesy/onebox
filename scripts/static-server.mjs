import { createServer } from "node:http";
import { readFile, realpath, access } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { publicRoute } from "../packages/game-core/public-route.ts";
const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = resolve(process.env.ONEBOX_SERVE_ROOT ?? `${project}/var/current`);
const assetRoot = resolve(
  process.env.ONEBOX_ASSET_ROOT ??
    (process.env.ONEBOX_SERVE_ROOT
      ? `${root}/assets`
      : `${project}/var/assets`),
);
const port = Number(process.env.ONEBOX_PORT ?? 4321);
const csp =
  "default-src 'none'; script-src 'none'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
const headers = {
  "Content-Security-Policy": csp,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), web-share=(self)",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Cache-Control": "public, no-cache, no-transform",
};
const server = createServer(async (req, res) => {
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  const localPort = server.address().port;
  const sources = [];
  const localHosts = [`127.0.0.1:${localPort}`, `localhost:${localPort}`];
  if (!process.env.PUBLIC_ORIGIN || localHosts.includes(req.headers.host)) {
    sources.push(...localHosts.map((host) => `http://${host}/assets/`));
  }
  if (process.env.PUBLIC_ORIGIN)
    sources.push(new URL("/assets/", process.env.PUBLIC_ORIGIN).href);
  res.setHeader(
    "Content-Security-Policy",
    csp.replace("script-src 'none'", `script-src ${sources.join(" ")}`),
  );
  if (!["GET", "HEAD"].includes(req.method ?? "")) {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }
  let pathname;
  let search;
  try {
    const url = new URL(req.url, "http://localhost");
    pathname = decodeURIComponent(url.pathname);
    search = url.search;
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (pathname === "/health") {
    let healthy = true;
    try {
      await access(resolve(root, "index.html"));
    } catch {
      healthy = false;
    }
    res.writeHead(healthy ? 200 : 503, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(
      req.method === "HEAD"
        ? undefined
        : JSON.stringify({
            status: healthy ? "ok" : "unavailable",
            stage: "playtest",
          }),
    );
    return;
  }
  if (pathname === "/robots.txt") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(req.method === "HEAD" ? undefined : "User-agent: *\nDisallow: /\n");
    return;
  }
  const route = publicRoute(pathname, search);
  const isHTML = Boolean(route);
  const isData =
    !search &&
    (pathname === "/release.json" ||
      /^\/puzzles\/[a-f0-9]{64}\.json$/.test(pathname));
  if (
    !isHTML &&
    !isData &&
    (search ||
      !/^\/assets\/(?:[a-zA-Z0-9_.-]+\.(js|css)|onebox-cover-[a-f0-9]{12}\.png)$/.test(
        pathname,
      ))
  ) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(req.method === "HEAD" ? undefined : "Not found");
    return;
  }
  try {
    const actualRoot = await realpath(isHTML || isData ? root : assetRoot),
      file = resolve(
        actualRoot,
        isHTML
          ? route.file
          : isData
            ? pathname.slice(1)
            : pathname.slice("/assets/".length),
      );
    let actualFile;
    try {
      actualFile = await realpath(file);
    } catch (error) {
      // Old playtest releases use one HTML file with the same fixed puzzle.
      // Preserve the known fixed link during rollback; never fall back for unknown slugs.
      if (!isHTML || error.code !== "ENOENT") throw error;
      actualFile = await realpath(resolve(actualRoot, "index.html"));
    }
    if (!actualFile.startsWith(actualRoot + sep)) throw Error("Outside root");
    const data = await readFile(actualFile);
    res.setHeader(
      "Content-Type",
      isData
        ? "application/json; charset=utf-8"
        : isHTML
          ? "text/html; charset=utf-8"
          : pathname.endsWith(".css")
            ? "text/css; charset=utf-8"
            : pathname.endsWith(".png")
              ? "image/png"
              : "text/javascript; charset=utf-8",
    );
    if (!isHTML && pathname !== "/release.json")
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.writeHead(200);
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(req.method === "HEAD" ? undefined : "Not found");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `ONEBOX playtest listening on 127.0.0.1:${server.address().port}`,
  ),
);
function close() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
