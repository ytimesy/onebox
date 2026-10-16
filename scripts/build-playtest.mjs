import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { artifactDigest } from "./artifact.mjs";
import { writePlaytestPages } from "./playtest-pages.mjs";
import { writePlaytestRelease } from "./playtest-release.mjs";
execFileSync("npm", ["run", "typecheck"], { stdio: "inherit" });
execFileSync(
  "npm",
  ["exec", "--", "vite", "build", "--outDir", "../../dist-playtest"],
  { env: { ...process.env, VITE_STAGE: "playtest" }, stdio: "inherit" },
);
const index = await readFile("dist-playtest/index.html", "utf8");
await writePlaytestPages("dist-playtest", index);
await writePlaytestRelease("dist-playtest");
execFileSync("node", ["scripts/check-dist.mjs", "dist-playtest"], {
  stdio: "inherit",
});
console.log(`Checked build digest: ${await artifactDigest("dist-playtest")}`);
