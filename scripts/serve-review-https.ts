import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { X509Certificate } from "node:crypto";
import { createReviewHttps } from "../packages/puzzle-tools/review-https.ts";
const dir = resolve("var/review-https"),
  config = JSON.parse(await readFile(`${dir}/config.json`, "utf8"));
if (
  !/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)\d/.test(config.bind) ||
  config.port !== 4325 ||
  !Array.isArray(config.hosts)
)
  throw Error("Invalid LAN-only binding");
const cert = await readFile(`${dir}/server.crt`),
  key = await readFile(`${dir}/server.key`);
if (Date.parse(new X509Certificate(cert).validTo) <= Date.now())
  throw Error(
    "Private reviewer TLS certificate expired; renew with install script",
  );
const server = createReviewHttps({
  cert,
  key,
  code: (await readFile(`${dir}/access-code.txt`, "utf8")).trim(),
  hosts: config.hosts,
  upstreamPort: 4324,
});
server.listen(config.port, config.bind, () =>
  console.log(
    `ONEBOX private LAN HTTPS listening on ${config.bind}:${config.port}`,
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
