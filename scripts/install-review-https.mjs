import { networkInterfaces } from "node:os";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  writeFile,
  chmod,
  readFile,
  realpath,
  lstat,
} from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
const project = process.cwd(),
  dir = resolve("var/review-https");
const rotate = process.argv.slice(2).join(" ") === "--rotate-code";
if (process.argv.length > 2 && !rotate)
  throw Error("Only --rotate-code is supported");
const interfaces = networkInterfaces();
const lan = Object.entries(interfaces)
  .filter(([name]) => /^en\d+$/.test(name))
  .flatMap(([, values]) => values ?? [])
  .find(
    (v) =>
      v.family === "IPv4" &&
      !v.internal &&
      /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(v.address),
  );
if (!lan)
  throw Error("No private LAN interface; do not expose reviewer to WAN");
const hostname =
  execFileSync("scutil", ["--get", "LocalHostName"], {
    encoding: "utf8",
  }).trim() + ".local";
if (!/^[a-zA-Z0-9-]+\.local$/.test(hostname))
  throw Error("Invalid local hostname");
const label = "local.onebox.reviewhttps",
  uid = String(process.getuid());
const plistPath = resolve(
  process.env.HOME,
  "Library/LaunchAgents",
  label + ".plist",
);
try {
  if ((await lstat(plistPath)).isSymbolicLink())
    throw Error("Refusing a symlinked agent");
  const existing = await readFile(plistPath, "utf8");
  if (!existing.includes(project + "/scripts/serve-review-https.ts"))
    throw Error("Refusing foreign agent");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const active = (() => {
  try {
    execFileSync("launchctl", ["print", `gui/${uid}/${label}`], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
})();
if (active) execFileSync("launchctl", ["bootout", `gui/${uid}/${label}`]);
const listening = (() => {
  try {
    return execFileSync("lsof", ["-nP", "-iTCP:4325", "-sTCP:LISTEN"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
})();
if (listening)
  throw Error("Port 4325 occupied; refusing to stop another listener");
await mkdir(dir, { recursive: true, mode: 0o700 });
if ((await realpath(dir)) !== dir)
  throw Error("Private TLS directory must not use symlinks");
for (const name of [
  "ca.key",
  "ca.crt",
  "server.key",
  "server.crt",
  "config.json",
  "access-code.txt",
  "extensions.txt",
  "server.csr",
  "ca.srl",
  "ONEBOX-Local-Trial-CA.cer",
]) {
  try {
    if ((await lstat(dir + "/" + name)).isSymbolicLink())
      throw Error("Private TLS files must not use symlinks");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
await chmod(dir, 0o700);
const run = (args) =>
  execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
// Keep the private CA stable so renewals do not require re-trusting it on phones.
try {
  await readFile(dir + "/ca.key");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  run([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "365",
    "-subj",
    "/CN=ONEBOX Local Trial CA",
    "-keyout",
    "ca.key",
    "-out",
    "ca.crt",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
  ]);
}
await writeFile(
  dir + "/extensions.txt",
  `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${hostname},IP:${lan.address}\n`,
  { mode: 0o600 },
);
run([
  "req",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-subj",
  `/CN=${hostname}`,
  "-keyout",
  "server.key",
  "-out",
  "server.csr",
]);
run([
  "x509",
  "-req",
  "-in",
  "server.csr",
  "-CA",
  "ca.crt",
  "-CAkey",
  "ca.key",
  "-CAcreateserial",
  "-days",
  "90",
  "-extfile",
  "extensions.txt",
  "-out",
  "server.crt",
]);
run([
  "x509",
  "-in",
  "ca.crt",
  "-outform",
  "DER",
  "-out",
  "ONEBOX-Local-Trial-CA.cer",
]);
for (const name of [
  "ca.key",
  "server.key",
  "ca.crt",
  "server.crt",
  "ONEBOX-Local-Trial-CA.cer",
])
  await chmod(dir + "/" + name, 0o600);
try {
  if (rotate)
    await writeFile(
      dir + "/access-code.txt",
      randomBytes(24).toString("hex") + "\n",
      { mode: 0o600 },
    );
  await readFile(dir + "/access-code.txt");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  await writeFile(
    dir + "/access-code.txt",
    randomBytes(24).toString("hex") + "\n",
    { mode: 0o600, flag: "wx" },
  );
}
await writeFile(
  dir + "/config.json",
  JSON.stringify({
    bind: lan.address,
    port: 4325,
    hosts: [`${lan.address}:4325`, `${hostname}:4325`],
  }),
  { mode: 0o600 },
);
const xml = (v) =>
  v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(project)}/scripts/serve-review-https.ts</string></array><key>WorkingDirectory</key><string>${xml(project)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>StandardOutPath</key><string>${xml(project)}/var/review-https/service.log</string><key>StandardErrorPath</key><string>${xml(project)}/var/review-https/error.log</string></dict></plist>`;
await writeFile(plistPath, plist, { mode: 0o600 });
execFileSync("launchctl", ["enable", `gui/${uid}/${label}`]);
execFileSync("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
console.log(`Private LAN HTTPS: https://${hostname}:4325/ (same LAN only)`);
console.log(
  "Trust only var/review-https/ONEBOX-Local-Trial-CA.cer on the trial phone; read access-code.txt on this PC. No codes/keys printed. No public tunnel/DNS changes.",
);
