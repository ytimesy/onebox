import { execFileSync } from "node:child_process";
execFileSync("npm", ["run", "typecheck"], { stdio: "inherit" });
execFileSync(
  "npm",
  [
    "exec",
    "--",
    "vite",
    "build",
    "apps/reviewer",
    "--outDir",
    "../../var/reviewer",
    "--emptyOutDir",
  ],
  {
    env: { ...process.env, VITE_STAGE: "reviewer" },
    stdio: "inherit",
  },
);
execFileSync("node", ["scripts/check-dist.mjs", "var/reviewer"], {
  stdio: "inherit",
});
console.log(
  "Reviewer assets only in var/reviewer; candidate payloads loaded by the loopback server.",
);
