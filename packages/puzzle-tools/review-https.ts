import { createServer, type ServerOptions } from "node:https";
import { request } from "node:http";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";

export function createReviewHttps(
  options: ServerOptions & {
    hosts: string[];
    code: string;
    upstreamPort: number;
    now?: () => number;
  },
) {
  if (
    !/^[a-f0-9]{48}$/.test(options.code) ||
    !options.hosts.length ||
    options.hosts.some(
      (host) =>
        typeof host !== "string" || !/^[a-zA-Z0-9.-]+:[0-9]{1,5}$/.test(host),
    ) ||
    !Number.isInteger(options.upstreamPort) ||
    options.upstreamPort < 1 ||
    options.upstreamPort > 65535
  )
    throw Error("Invalid private gateway configuration");
  const secret = randomBytes(32),
    now = options.now ?? Date.now;
  const attempts = new Map<string, { count: number; until: number }>();
  const sign = (value: string) =>
    createHmac("sha256", secret).update(value).digest("hex");
  const equal = (a: string, b: string) => {
    const left = Buffer.from(a),
      right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  };
  const cookieName = "__Host-onebox-review";
  const server = createServer(options, async (req, res) => {
    const headers: Record<string, string> = {
      "Cache-Control": "no-store",
      // Preserve the same-origin Origin header on the access form POST while
      // sending no referrer to other origins; CSRF validation remains strict.
      "Referrer-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
    };
    for (const [key, value] of Object.entries(headers))
      res.setHeader(key, value);
    const send = (
      status: number,
      body = "",
      type = "text/plain; charset=utf-8",
    ) => {
      res.writeHead(status, { "Content-Type": type });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    const host = (req.headers.host ?? "").toLowerCase();
    if (
      !options.hosts.some((value) => value.toLowerCase() === host) ||
      req.headers["sec-fetch-site"] === "cross-site" ||
      (req.headers.origin && req.headers.origin !== `https://${host}`)
    )
      return send(403);
    let path: string;
    try {
      const url = new URL(req.url ?? "/", `https://${host}`);
      if (url.host !== host || url.search) return send(404);
      path = url.pathname;
    } catch {
      return send(400);
    }
    if (req.method === "POST" && path === "/access") {
      if (
        req.headers.origin !== `https://${host}` ||
        req.headers["content-type"] !== "application/x-www-form-urlencoded"
      )
        return send(403);
      const peer = req.socket.remoteAddress ?? "unknown",
        recent = attempts.get(peer);
      for (const [ip, attempt] of attempts)
        if (attempt.until <= now()) attempts.delete(ip);
      const item =
        recent && recent.until > now()
          ? recent
          : { count: 0, until: now() + 60000 };
      if (item.count >= 5 || (!attempts.has(peer) && attempts.size >= 100))
        return send(429);
      item.count++;
      attempts.set(peer, item);
      let body = "";
      try {
        for await (const chunk of req) {
          body += chunk.toString();
          if (Buffer.byteLength(body) > 128) {
            send(413);
            return;
          }
        }
      } catch {
        return send(400);
      }
      const params = new URLSearchParams(body);
      if (
        [...params.keys()].length !== 1 ||
        !equal(params.get("code") ?? "", options.code)
      )
        return send(403, "Access denied");
      attempts.delete(peer);
      const expires = String(now() + 12 * 3600000),
        session = `${expires}.${sign(expires)}`;
      res.setHeader(
        "Set-Cookie",
        `${cookieName}=${session}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=43200`,
      );
      res.setHeader("Location", "/");
      send(303);
      return;
    }
    const session =
      (req.headers.cookie ?? "")
        .split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith(cookieName + "="))
        ?.slice(cookieName.length + 1) ?? "";
    const [expires, mac] = session.split(".");
    const authed =
      /^\d{13}\.[a-f0-9]{64}$/.test(session) &&
      /^[a-f0-9]{64}$/.test(mac ?? "") &&
      Number(expires) > now() &&
      Number(expires) <= now() + 12 * 3600000 &&
      equal(mac, sign(expires));
    if (req.method === "POST" && path === "/logout") {
      if (!authed || req.headers.origin !== `https://${host}`) return send(403);
      res.setHeader(
        "Set-Cookie",
        `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`,
      );
      res.setHeader("Location", "/");
      send(303);
      return;
    }
    if (!["GET", "HEAD"].includes(req.method ?? "")) {
      res.setHeader("Allow", "GET, HEAD");
      return send(405);
    }
    if (!authed) {
      if (path !== "/") return send(403);
      return send(
        200,
        '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ONEBOX 非公開試遊</title><h1>ONEBOX 非公開試遊</h1><p>このPCのアクセスコードを入力してください。コードはURLに含めません。</p><form method="post" action="/access"><label>アクセスコード <input name="code" type="password" required maxlength="48" autocomplete="off"></label><button>試遊画面を開く</button></form></html>',
        "text/html; charset=utf-8",
      );
    }
    if (
      !/^(?:\/|\/index\.html|\/api\/candidates|\/api\/inventory|\/api\/candidate\/candidate-[a-f0-9]{12}|\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css))$/.test(
        path,
      )
    )
      return send(404);
    const upstream = request(
      {
        hostname: "127.0.0.1",
        port: options.upstreamPort,
        path,
        method: req.method,
        headers: { Host: `127.0.0.1:${options.upstreamPort}` },
        timeout: 5000,
      },
      (response) => {
        res.statusCode = response.statusCode ?? 503;
        res.setHeader(
          "Content-Type",
          response.headers["content-type"] ?? "text/plain; charset=utf-8",
        );
        response.pipe(res);
      },
    );
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => {
      if (!res.headersSent) send(503, "Private reviewer unavailable");
      else res.destroy();
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => {
      if (!res.writableEnded) upstream.destroy();
    });
    upstream.end();
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}
