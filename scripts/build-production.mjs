import { execFileSync } from "node:child_process";
import { writeFile, readdir, unlink } from "node:fs/promises";
import { writePlaytestPages } from "./playtest-pages.mjs";
import { artifactDigest } from "./artifact.mjs";
import { readFile } from "node:fs/promises";
execFileSync("npm", ["run", "typecheck"], { stdio: "inherit" });
execFileSync(
  "npm",
  ["exec", "--", "vite", "build", "--outDir", "../../dist-production-shell"],
  { env: { ...process.env, VITE_STAGE: "daily" }, stdio: "inherit" },
);
const source = await readFile("dist-production-shell/index.html", "utf8");
// Reuse the branded canvas generator; keep only its generic asset in this shell.
await writePlaytestPages("dist-production-shell", source, {
  label: "One box. A little joy.",
});
await writeFile("dist-production-shell/index.html", source);
await writeFile(
  "dist-production-shell/.PRODUCTION_SHELL",
  "ONEBOX production shell v1\n",
);
console.log(
  "Production shell digest: " + (await artifactDigest("dist-production-shell")),
);
